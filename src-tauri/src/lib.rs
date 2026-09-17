// Owns CSV data and exposes paged operations to the Tauri frontend.
// FEATURE: CSV data workspace
use chrono::NaiveDate;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::File;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tauri::State;
use uuid::Uuid;

#[derive(Default)]
struct AppState {
    next_dataset_id: AtomicU64,
    datasets: Mutex<HashMap<String, Dataset>>,
}

struct Dataset {
    columns: Vec<String>,
    rows: Arc<Vec<Vec<String>>>,
    view: Vec<usize>,
    order: Vec<usize>,
    column_types: Vec<String>,
    separator: u8,
    size_bytes: u64,
    source_id: Option<String>,
    filter: Option<FilterSpec>,
    sorting: Vec<SortSpec>,
    search: Option<FilterSpec>,
    search_matches: Vec<(usize, usize)>,
}

#[derive(Clone)]
struct FilterSpec {
    pattern: String,
    is_regex: bool,
    is_case_sensitive: bool,
    columns: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SortSpec {
    id: String,
    desc: bool,
    column_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SheetMetadata {
    dataset_id: String,
    columns: Vec<String>,
    column_types: HashMap<String, String>,
    row_count: usize,
    size_bytes: u64,
    separator: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RowPage {
    offset: usize,
    rows: Vec<Vec<String>>,
    matches: Vec<SearchMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    row_index: usize,
    column_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartData {
    x_values: Vec<String>,
    y_values: Option<Vec<String>>,
    group_values: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ColumnStats {
    Number {
        sum: f64,
        avg: f64,
        min: f64,
        max: f64,
        #[serde(rename = "stdDev")]
        std_dev: f64,
        mode: f64,
    },
    Date {
        min: String,
        max: String,
    },
    Category {
        most: (String, usize),
        least: (String, usize),
    },
    Boolean {
        #[serde(rename = "trueCount")]
        true_count: usize,
        #[serde(rename = "falseCount")]
        false_count: usize,
    },
}

enum Matcher {
    Regex(Regex),
    Plain(String, bool),
}

impl Matcher {
    fn is_match(&self, value: &str) -> bool {
        match self {
            Self::Regex(regex) => regex.is_match(value),
            Self::Plain(pattern, true) => value.contains(pattern),
            Self::Plain(pattern, false) => value.to_lowercase().contains(pattern),
        }
    }
}

fn datasets<'a>(
    state: &'a State<'_, AppState>,
) -> Result<MutexGuard<'a, HashMap<String, Dataset>>, String> {
    state.datasets.lock().map_err(|error| error.to_string())
}

fn separator_byte(separator: &str) -> Result<u8, String> {
    let bytes = separator.as_bytes();
    if bytes.len() != 1 {
        return Err("CSV separator must be one ASCII character".into());
    }
    Ok(bytes[0])
}

fn read_dataset(path: &str, separator: u8) -> Result<Dataset, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let size_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(separator)
        .flexible(true)
        .from_reader(file);
    let columns = reader
        .headers()
        .map_err(|error| error.to_string())?
        .iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|error| error.to_string())?;
        if record.iter().all(|value| value.is_empty()) {
            continue;
        }
        let mut row = record.iter().map(str::to_owned).collect::<Vec<_>>();
        row.resize(columns.len(), String::new());
        rows.push(row);
    }
    let column_types = infer_column_types(&rows, columns.len());
    let view = (0..rows.len()).collect::<Vec<_>>();
    Ok(Dataset {
        columns,
        rows: Arc::new(rows),
        order: view.clone(),
        view,
        column_types,
        separator,
        size_bytes,
        source_id: None,
        filter: None,
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
    })
}

fn metadata(id: &str, dataset: &Dataset) -> SheetMetadata {
    SheetMetadata {
        dataset_id: id.to_owned(),
        columns: dataset.columns.clone(),
        column_types: dataset
            .columns
            .iter()
            .cloned()
            .zip(dataset.column_types.iter().cloned())
            .collect(),
        row_count: dataset.view.len(),
        size_bytes: dataset.size_bytes,
        separator: char::from(dataset.separator).to_string(),
    }
}

fn build_matcher(spec: &FilterSpec) -> Result<Option<Matcher>, String> {
    if spec.pattern.is_empty() {
        return Ok(None);
    }
    if spec.is_regex {
        RegexBuilder::new(&spec.pattern)
            .case_insensitive(!spec.is_case_sensitive)
            .build()
            .map(Matcher::Regex)
            .map(Some)
            .map_err(|error| error.to_string())
    } else {
        let pattern = if spec.is_case_sensitive {
            spec.pattern.clone()
        } else {
            spec.pattern.to_lowercase()
        };
        Ok(Some(Matcher::Plain(pattern, spec.is_case_sensitive)))
    }
}

fn matching_rows(dataset: &Dataset, spec: &FilterSpec) -> Result<Vec<usize>, String> {
    let Some(matcher) = build_matcher(spec)? else {
        return Ok(Vec::new());
    };
    let column_indices = matching_column_indices(dataset, spec);
    Ok(dataset
        .view
        .iter()
        .copied()
        .filter(|row_index| {
            column_indices
                .iter()
                .any(|column_index| matcher.is_match(&dataset.rows[*row_index][*column_index]))
        })
        .collect())
}

fn matching_column_indices(dataset: &Dataset, spec: &FilterSpec) -> Vec<usize> {
    if spec.columns.is_empty() {
        return (0..dataset.columns.len()).collect();
    }
    spec.columns
        .iter()
        .filter_map(|selected| dataset.columns.iter().position(|column| column == selected))
        .collect()
}

fn infer_column_types(rows: &[Vec<String>], column_count: usize) -> Vec<String> {
    (0..column_count)
        .map(|column_index| {
            let values = rows
                .iter()
                .filter_map(|row| row.get(column_index))
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if values.is_empty() {
                "string"
            } else if values.iter().all(|value| {
                value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false")
            }) {
                "boolean"
            } else if values.iter().all(|value| is_number(value)) {
                "number"
            } else if values.iter().all(|value| Uuid::parse_str(value).is_ok()) {
                "uuid"
            } else if values.iter().all(|value| parse_date(value).is_some()) {
                "date"
            } else {
                let mut counts = HashMap::new();
                for value in &values {
                    counts.insert(*value, ());
                }
                if counts.len() <= 20 && counts.len() * 2 <= values.len() {
                    "category"
                } else {
                    "string"
                }
            }
            .to_owned()
        })
        .collect()
}

fn is_number(value: &str) -> bool {
    static NUMBER: OnceLock<Regex> = OnceLock::new();
    NUMBER
        .get_or_init(|| {
            Regex::new(r"^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
                .expect("valid number regex")
        })
        .is_match(value)
        && value.parse::<f64>().is_ok_and(f64::is_finite)
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    if value.len() > 10 && !matches!(value.as_bytes()[10], b'T' | b' ') {
        return None;
    }
    let date = value.get(..10)?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn compare_values(a: &str, b: &str, column_type: &str) -> Ordering {
    match column_type {
        "number" => a
            .parse::<f64>()
            .unwrap_or(f64::NAN)
            .partial_cmp(&b.parse::<f64>().unwrap_or(f64::NAN))
            .unwrap_or(Ordering::Equal),
        "date" => parse_date(a).cmp(&parse_date(b)),
        "uuid" => match (Uuid::parse_str(a), Uuid::parse_str(b)) {
            (Ok(a), Ok(b)) => a.as_bytes().cmp(b.as_bytes()),
            _ => a.cmp(b),
        },
        "boolean" => a
            .eq_ignore_ascii_case("true")
            .cmp(&b.eq_ignore_ascii_case("true")),
        _ => a.to_lowercase().cmp(&b.to_lowercase()),
    }
}

fn apply_sort(dataset: &mut Dataset) {
    dataset.order = dataset.view.clone();
    if dataset.sorting.is_empty() {
        return;
    }
    let columns = dataset
        .sorting
        .iter()
        .filter_map(|sort| {
            dataset
                .columns
                .iter()
                .position(|column| column == &sort.id)
                .map(|index| (index, sort.clone()))
        })
        .collect::<Vec<_>>();
    let rows = Arc::clone(&dataset.rows);
    dataset.order.sort_by(|a, b| {
        for (column_index, sort) in &columns {
            let ordering = compare_values(
                &rows[*a][*column_index],
                &rows[*b][*column_index],
                &sort.column_type,
            );
            if ordering != Ordering::Equal {
                return if sort.desc {
                    ordering.reverse()
                } else {
                    ordering
                };
            }
        }
        a.cmp(b)
    });
}

fn apply_search(dataset: &mut Dataset) -> Result<(), String> {
    dataset.search_matches.clear();
    let Some(spec) = &dataset.search else {
        return Ok(());
    };
    let Some(matcher) = build_matcher(spec)? else {
        return Ok(());
    };
    let column_indices = matching_column_indices(dataset, spec);
    for (row_index, source_row) in dataset.order.iter().enumerate() {
        for column_index in &column_indices {
            let value = &dataset.rows[*source_row][*column_index];
            if matcher.is_match(value) {
                dataset.search_matches.push((row_index, *column_index));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn load_csv_file(
    path: String,
    separator: String,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    let separator = separator_byte(&separator)?;
    let dataset = read_dataset(&path, separator)?;
    let id = state
        .next_dataset_id
        .fetch_add(1, AtomicOrdering::Relaxed)
        .to_string();
    let result = metadata(&id, &dataset);
    datasets(&state)?.insert(id, dataset);
    Ok(result)
}

#[tauri::command]
async fn rescan_csv_file(
    dataset_id: String,
    path: String,
    separator: String,
    state: State<'_, AppState>,
) -> Result<Vec<SheetMetadata>, String> {
    let separator = separator_byte(&separator)?;
    let mut root = read_dataset(&path, separator)?;
    let mut store = datasets(&state)?;
    root.sorting = store
        .get(&dataset_id)
        .map(|dataset| dataset.sorting.clone())
        .unwrap_or_default();
    apply_sort(&mut root);
    let child_specs = store
        .iter()
        .filter(|(_, dataset)| dataset.source_id.as_deref() == Some(&dataset_id))
        .map(|(id, dataset)| (id.clone(), dataset.filter.clone(), dataset.sorting.clone()))
        .collect::<Vec<_>>();
    store.insert(dataset_id.clone(), root);

    for (child_id, filter, sorting) in child_specs {
        let source = store.get(&dataset_id).ok_or("Source dataset not found")?;
        let filter = filter.ok_or("Filtered dataset is missing its filter")?;
        let view = matching_rows(source, &filter)?;
        let mut child = Dataset {
            columns: source.columns.clone(),
            rows: Arc::clone(&source.rows),
            order: view.clone(),
            view,
            column_types: source.column_types.clone(),
            separator: source.separator,
            size_bytes: 0,
            source_id: Some(dataset_id.clone()),
            filter: Some(filter),
            sorting,
            search: None,
            search_matches: Vec::new(),
        };
        apply_sort(&mut child);
        store.insert(child_id, child);
    }

    Ok(store
        .iter()
        .filter(|(id, dataset)| {
            *id == &dataset_id || dataset.source_id.as_deref() == Some(&dataset_id)
        })
        .map(|(id, dataset)| metadata(id, dataset))
        .collect())
}

#[tauri::command]
async fn create_filtered_dataset(
    source_id: String,
    pattern: String,
    is_regex: bool,
    is_case_sensitive: bool,
    columns: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Option<SheetMetadata>, String> {
    let filter = FilterSpec {
        pattern,
        is_regex,
        is_case_sensitive,
        columns,
    };
    let mut store = datasets(&state)?;
    let source = store.get(&source_id).ok_or("Source dataset not found")?;
    let view = matching_rows(source, &filter)?;
    if view.is_empty() {
        return Ok(None);
    }
    let id = state
        .next_dataset_id
        .fetch_add(1, AtomicOrdering::Relaxed)
        .to_string();
    let dataset = Dataset {
        columns: source.columns.clone(),
        rows: Arc::clone(&source.rows),
        order: view.clone(),
        view,
        column_types: source.column_types.clone(),
        separator: source.separator,
        size_bytes: 0,
        source_id: Some(source_id),
        filter: Some(filter),
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
    };
    let result = metadata(&id, &dataset);
    store.insert(id, dataset);
    Ok(Some(result))
}

#[tauri::command]
fn close_dataset(dataset_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut store = datasets(&state)?;
    let children = store
        .iter()
        .filter(|(_, dataset)| dataset.source_id.as_deref() == Some(&dataset_id))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    store.remove(&dataset_id);
    for child in children {
        store.remove(&child);
    }
    Ok(())
}

#[tauri::command]
async fn get_rows(
    dataset_id: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<RowPage, String> {
    let store = datasets(&state)?;
    let dataset = store.get(&dataset_id).ok_or("Dataset not found")?;
    let rows = dataset
        .order
        .iter()
        .skip(offset)
        .take(limit)
        .map(|row_index| dataset.rows[*row_index].clone())
        .collect();
    let end = offset + limit;
    let matches = dataset
        .search_matches
        .iter()
        .filter(|(row_index, _)| *row_index >= offset && *row_index < end)
        .map(|(row_index, column_index)| SearchMatch {
            row_index: *row_index,
            column_id: dataset.columns[*column_index].clone(),
        })
        .collect();
    Ok(RowPage {
        offset,
        rows,
        matches,
    })
}

#[tauri::command]
async fn sort_dataset(
    dataset_id: String,
    sorting: Vec<SortSpec>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut store = datasets(&state)?;
    let dataset = store.get_mut(&dataset_id).ok_or("Dataset not found")?;
    dataset.sorting = sorting;
    apply_sort(dataset);
    apply_search(dataset)?;
    Ok(())
}

#[tauri::command]
async fn search_dataset(
    dataset_id: String,
    pattern: String,
    is_regex: bool,
    is_case_sensitive: bool,
    columns: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let spec = FilterSpec {
        pattern,
        is_regex,
        is_case_sensitive,
        columns,
    };
    let mut store = datasets(&state)?;
    let dataset = store.get_mut(&dataset_id).ok_or("Dataset not found")?;
    dataset.search = Some(spec);
    apply_search(dataset)?;
    Ok(dataset.search_matches.len())
}

#[tauri::command]
async fn get_search_match(
    dataset_id: String,
    index: usize,
    state: State<'_, AppState>,
) -> Result<Option<SearchMatch>, String> {
    let store = datasets(&state)?;
    let dataset = store.get(&dataset_id).ok_or("Dataset not found")?;
    Ok(dataset
        .search_matches
        .get(index)
        .map(|(row_index, column_index)| SearchMatch {
            row_index: *row_index,
            column_id: dataset.columns[*column_index].clone(),
        }))
}

#[tauri::command]
async fn get_column_stats(
    dataset_id: String,
    column: String,
    column_type: String,
    state: State<'_, AppState>,
) -> Result<Option<ColumnStats>, String> {
    let store = datasets(&state)?;
    let dataset = store.get(&dataset_id).ok_or("Dataset not found")?;
    let column_index = dataset
        .columns
        .iter()
        .position(|name| name == &column)
        .ok_or("Column not found")?;
    let values = dataset
        .view
        .iter()
        .map(|row_index| dataset.rows[*row_index][column_index].as_str())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Ok(None);
    }

    let stats = match column_type.as_str() {
        "number" => {
            let numbers = values
                .iter()
                .filter_map(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite())
                .collect::<Vec<_>>();
            if numbers.is_empty() {
                return Ok(None);
            }
            let sum = numbers.iter().sum::<f64>();
            let avg = sum / numbers.len() as f64;
            let min = numbers.iter().copied().fold(f64::INFINITY, f64::min);
            let max = numbers.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let variance = numbers
                .iter()
                .map(|value| (value - avg).powi(2))
                .sum::<f64>()
                / numbers.len() as f64;
            let mut frequencies = HashMap::<u64, usize>::new();
            for value in &numbers {
                *frequencies.entry(value.to_bits()).or_default() += 1;
            }
            let mode = frequencies
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(bits, _)| f64::from_bits(bits))
                .unwrap_or(numbers[0]);
            ColumnStats::Number {
                sum,
                avg,
                min,
                max,
                std_dev: variance.sqrt(),
                mode,
            }
        }
        "date" => {
            let dates = values
                .iter()
                .filter_map(|value| parse_date(value))
                .collect::<Vec<_>>();
            let Some(min) = dates.iter().min() else {
                return Ok(None);
            };
            let max = dates.iter().max().expect("non-empty dates");
            ColumnStats::Date {
                min: min.format("%Y-%m-%dT00:00:00.000Z").to_string(),
                max: max.format("%Y-%m-%dT00:00:00.000Z").to_string(),
            }
        }
        "category" => {
            let mut frequencies = HashMap::<&str, usize>::new();
            for value in values {
                *frequencies.entry(value).or_default() += 1;
            }
            let most = frequencies
                .iter()
                .max_by_key(|(_, count)| **count)
                .map(|(value, count)| ((*value).to_owned(), *count))
                .expect("non-empty categories");
            let least = frequencies
                .iter()
                .min_by_key(|(_, count)| **count)
                .map(|(value, count)| ((*value).to_owned(), *count))
                .expect("non-empty categories");
            ColumnStats::Category { most, least }
        }
        "boolean" => {
            let true_count = values
                .iter()
                .filter(|value| value.eq_ignore_ascii_case("true"))
                .count();
            ColumnStats::Boolean {
                true_count,
                false_count: values.len() - true_count,
            }
        }
        _ => return Ok(None),
    };
    Ok(Some(stats))
}

#[tauri::command]
async fn get_chart_data(
    dataset_id: String,
    x_column: String,
    y_column: Option<String>,
    group_column: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChartData, String> {
    let store = datasets(&state)?;
    let dataset = store.get(&dataset_id).ok_or("Dataset not found")?;
    let column_index = |name: &str| {
        dataset
            .columns
            .iter()
            .position(|column| column.as_str() == name)
            .ok_or_else(|| format!("Column not found: {name}"))
    };
    let x_index = column_index(&x_column)?;
    let y_index = y_column.as_deref().map(column_index).transpose()?;
    let group_index = group_column.as_deref().map(column_index).transpose()?;
    let column_values = |index: usize| {
        dataset
            .order
            .iter()
            .map(|row| dataset.rows[*row][index].clone())
            .collect()
    };
    Ok(ChartData {
        x_values: column_values(x_index),
        y_values: y_index.map(column_values),
        group_values: group_index.map(column_values),
    })
}

#[tauri::command]
async fn save_csv_file(
    dataset_id: String,
    path: String,
    columns: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = datasets(&state)?;
    let dataset = store.get(&dataset_id).ok_or("Dataset not found")?;
    let mut writer = csv::WriterBuilder::new()
        .delimiter(dataset.separator)
        .from_path(path)
        .map_err(|error| error.to_string())?;
    let column_indices = columns
        .iter()
        .map(|column| {
            dataset
                .columns
                .iter()
                .position(|candidate| candidate == column)
                .ok_or_else(|| format!("Column not found: {column}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    writer
        .write_record(&columns)
        .map_err(|error| error.to_string())?;
    for row_index in &dataset.order {
        writer
            .write_record(
                column_indices
                    .iter()
                    .map(|column_index| &dataset.rows[*row_index][*column_index]),
            )
            .map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn list_csv_files() -> Result<Vec<String>, String> {
    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    let output = std::process::Command::new("fd")
        .args([
            "--type",
            "f",
            "--extension",
            "csv",
            "--exclude",
            "Library",
            "--exclude",
            "Applications",
            "--exclude",
            "Dropbox",
            "--exclude",
            "Google Drive",
            "--exclude",
            "OneDrive",
            ".",
            &home,
        ])
        .output()
        .map_err(|error| format!("fd not found: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_owned)
        .collect())
}

#[tauri::command]
fn fzf_available() -> bool {
    std::process::Command::new("fzf")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[tauri::command]
fn fuzzy_filter(query: String, candidates: Vec<String>) -> Result<Vec<String>, String> {
    if query.is_empty() {
        return Ok(candidates);
    }
    use std::io::Write;
    let mut child = std::process::Command::new("fzf")
        .arg("--filter")
        .arg(&query)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("fzf not found: {error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("failed to open fzf stdin")?
        .write_all(candidates.join("\n").as_bytes())
        .map_err(|error| error.to_string())?;
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::to_owned)
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_csv_file,
            rescan_csv_file,
            create_filtered_dataset,
            close_dataset,
            get_rows,
            sort_dataset,
            search_dataset,
            get_search_match,
            get_column_stats,
            get_chart_data,
            save_csv_file,
            list_csv_files,
            fzf_available,
            fuzzy_filter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_csv_and_infers_types() {
        let path = std::env::temp_dir().join(format!(
            "coccinella-test-{}-{}.csv",
            std::process::id(),
            std::thread::current().name().unwrap_or("csv")
        ));
        std::fs::write(
            &path,
            "name,id,score,active\nAda,550e8400-e29b-41d4-a716-446655440000,10,true\n\nBob,123e4567-e89b-12d3-a456-426614174000,20,false\n",
        )
        .expect("write fixture");

        let dataset = read_dataset(path.to_str().expect("UTF-8 path"), b',').expect("parse CSV");
        std::fs::remove_file(path).expect("remove fixture");

        assert_eq!(dataset.columns, ["name", "id", "score", "active"]);
        assert_eq!(dataset.rows.len(), 2);
        assert_eq!(
            dataset.column_types,
            ["string", "uuid", "number", "boolean"]
        );
    }

    #[test]
    fn filters_sorts_and_indexes_search_matches() {
        let mut dataset = Dataset {
            columns: vec!["name".into(), "score".into()],
            rows: Arc::new(vec![
                vec!["Ada".into(), "10".into()],
                vec!["Bob".into(), "20".into()],
                vec!["Adam".into(), "15".into()],
            ]),
            view: vec![0, 1, 2],
            order: vec![0, 1, 2],
            column_types: vec!["string".into(), "number".into()],
            separator: b',',
            size_bytes: 0,
            source_id: None,
            filter: None,
            sorting: vec![SortSpec {
                id: "score".into(),
                desc: true,
                column_type: "number".into(),
            }],
            search: Some(FilterSpec {
                pattern: "^Ada$".into(),
                is_regex: true,
                is_case_sensitive: true,
                columns: vec!["name".into()],
            }),
            search_matches: Vec::new(),
        };

        let filtered = matching_rows(
            &dataset,
            &FilterSpec {
                pattern: "^Ada".into(),
                is_regex: true,
                is_case_sensitive: true,
                columns: Vec::new(),
            },
        )
        .expect("filter rows");
        assert_eq!(filtered, [0, 2]);
        let restricted = matching_rows(
            &dataset,
            &FilterSpec {
                pattern: "^Ada".into(),
                is_regex: true,
                is_case_sensitive: true,
                columns: vec!["score".into()],
            },
        )
        .expect("filter selected column");
        assert!(restricted.is_empty());

        apply_sort(&mut dataset);
        apply_search(&mut dataset).expect("index search");
        assert_eq!(dataset.order, [1, 2, 0]);
        assert_eq!(dataset.search_matches, [(2, 0)]);

        dataset.search = Some(FilterSpec {
            pattern: String::new(),
            is_regex: true,
            is_case_sensitive: false,
            columns: Vec::new(),
        });
        apply_search(&mut dataset).expect("clear search");
        assert!(dataset.search_matches.is_empty());
    }
}
