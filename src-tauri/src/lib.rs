// Owns CSV data and exposes paged operations to the Tauri frontend.
// FEATURE: CSV data workspace
use chrono::NaiveDate;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_CSV_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 1_000_000;
const MAX_CSV_FIELDS: usize = 10_000_000;
const MAX_CSV_COLUMNS: usize = 10_000;
const TYPE_INFERENCE_ROWS: usize = 10_000;
const MAX_CHART_POINTS: usize = 100_000;
const MAX_INDEXED_FILES: &str = "10000";
const CATEGORY_MAX_DISTINCT_VALUES: usize = 20;
const CATEGORY_MAX_DISTINCT_RATIO: usize = 2;
const VARIANCE_POWER: i32 = 2;

type DatasetHandle = Arc<Mutex<Dataset>>;
type DatasetStore = HashMap<String, DatasetHandle>;
type RowIndex = u32;
type ColumnIndex = u32;

#[derive(Clone)]
struct PackedRows {
    data: String,
    cell_offsets: Vec<u32>,
    row_offsets: Vec<u32>,
    column_count: usize,
}

impl PackedRows {
    fn with_capacity(column_count: usize, data_capacity: usize) -> Self {
        Self {
            data: String::with_capacity(data_capacity),
            cell_offsets: vec![0],
            row_offsets: vec![0],
            column_count,
        }
    }

    fn push_record(&mut self, record: &csv::StringRecord) -> Result<(), String> {
        if record.len() != self.column_count {
            return Err(format!(
                "CSV row has {} fields; expected {}",
                record.len(),
                self.column_count
            ));
        }
        for field in record {
            self.data.push_str(field);
            self.cell_offsets.push(self.current_offset()?);
        }
        self.row_offsets.push(self.current_offset()?);
        Ok(())
    }

    fn current_offset(&self) -> Result<u32, String> {
        u32::try_from(self.data.len()).map_err(|_| "CSV decoded data exceeds 4 GiB".into())
    }

    fn len(&self) -> usize {
        self.row_offsets.len() - 1
    }

    fn cell(&self, row_index: usize, column_index: usize) -> &str {
        let cell_index = row_index * self.column_count + column_index;
        let start = self.cell_offsets[cell_index] as usize;
        let end = self.cell_offsets[cell_index + 1] as usize;
        &self.data[start..end]
    }

    fn row_owned(&self, row_index: usize) -> Vec<String> {
        (0..self.column_count)
            .map(|column_index| self.cell(row_index, column_index).to_owned())
            .collect()
    }

    fn shrink_to_fit(&mut self) {
        self.data.shrink_to_fit();
        self.cell_offsets.shrink_to_fit();
        self.row_offsets.shrink_to_fit();
    }

    #[cfg(test)]
    fn allocated_bytes(&self) -> usize {
        self.data.capacity()
            + self.cell_offsets.capacity() * std::mem::size_of::<u32>()
            + self.row_offsets.capacity() * std::mem::size_of::<u32>()
    }
}

#[derive(Default)]
struct AppState {
    next_dataset_id: AtomicU64,
    next_path_token: AtomicU64,
    datasets: Mutex<DatasetStore>,
    indexed_paths: Mutex<HashMap<String, PathBuf>>,
}

#[derive(Clone)]
struct Dataset {
    columns: Vec<String>,
    rows: Arc<PackedRows>,
    view: Vec<RowIndex>,
    order: Vec<RowIndex>,
    column_types: Vec<String>,
    separator: u8,
    size_bytes: u64,
    source_id: Option<String>,
    filter: Option<FilterSpec>,
    sorting: Vec<SortSpec>,
    search: Option<FilterSpec>,
    search_matches: Vec<(RowIndex, ColumnIndex)>,
    source_path: Option<PathBuf>,
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
#[serde(rename_all = "camelCase")]
struct OpenedSheet {
    filename: String,
    path: String,
    metadata: SheetMetadata,
}

#[derive(Serialize)]
struct FileCandidate {
    token: String,
    path: String,
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

fn datasets<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, DatasetStore>, String> {
    state.datasets.lock().map_err(|error| error.to_string())
}

fn dataset(state: &State<'_, AppState>, id: &str) -> Result<DatasetHandle, String> {
    datasets(state)?
        .get(id)
        .cloned()
        .ok_or("Dataset not found".into())
}

fn lock_dataset(handle: &DatasetHandle) -> Result<MutexGuard<'_, Dataset>, String> {
    handle.lock().map_err(|error| error.to_string())
}

fn separator_byte(separator: &str) -> Result<u8, String> {
    let bytes = separator.as_bytes();
    if bytes.len() != 1 {
        return Err("CSV separator must be one ASCII character".into());
    }
    Ok(bytes[0])
}

fn validate_csv_path(path: &str) -> Result<(), String> {
    let is_csv = std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"));
    if is_csv {
        Ok(())
    } else {
        Err("Only .csv files are supported".into())
    }
}

fn insert_dataset(dataset: Dataset, state: &State<'_, AppState>) -> Result<SheetMetadata, String> {
    let id = state
        .next_dataset_id
        .fetch_add(1, AtomicOrdering::Relaxed)
        .to_string();
    let result = metadata(&id, &dataset);
    datasets(state)?.insert(id, Arc::new(Mutex::new(dataset)));
    Ok(result)
}

fn validated_columns(headers: &csv::StringRecord) -> Result<Vec<String>, String> {
    let mut used = HashSet::new();
    headers
        .iter()
        .enumerate()
        .map(|(index, header)| {
            if header.is_empty() {
                return Err(format!("CSV header {} is empty", index + 1));
            }
            if !used.insert(header) {
                return Err(format!("CSV header is duplicated: {header}"));
            }
            Ok(header.to_owned())
        })
        .collect()
}

fn read_dataset(path: &str, separator: u8) -> Result<Dataset, String> {
    validate_csv_path(path)?;
    let file = File::open(path).map_err(|error| error.to_string())?;
    let size_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if size_bytes > MAX_CSV_FILE_BYTES {
        return Err(format!(
            "CSV is too large: {size_bytes} bytes exceeds the {MAX_CSV_FILE_BYTES}-byte limit"
        ));
    }
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(separator)
        .from_reader(file);
    let columns = validated_columns(reader.headers().map_err(|error| error.to_string())?)?;
    if columns.len() > MAX_CSV_COLUMNS {
        return Err(format!("CSV exceeds the {MAX_CSV_COLUMNS}-column limit"));
    }
    let mut rows = PackedRows::with_capacity(columns.len(), size_bytes as usize);
    let mut field_count = columns.len();
    let mut record = csv::StringRecord::new();
    while reader
        .read_record(&mut record)
        .map_err(|error| error.to_string())?
    {
        if rows.len() >= MAX_CSV_ROWS {
            return Err(format!("CSV exceeds the {MAX_CSV_ROWS}-row limit"));
        }
        field_count += record.len();
        if field_count > MAX_CSV_FIELDS {
            return Err(format!("CSV exceeds the {MAX_CSV_FIELDS}-field limit"));
        }
        rows.push_record(&record)?;
    }
    let column_types = infer_column_types(&rows, columns.len());
    let view = (0..rows.len())
        .map(|index| RowIndex::try_from(index).expect("row limit fits in u32"))
        .collect::<Vec<_>>();
    rows.shrink_to_fit();
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
        source_path: Some(std::fs::canonicalize(path).map_err(|error| error.to_string())?),
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

fn matching_rows(dataset: &Dataset, spec: &FilterSpec) -> Result<Vec<RowIndex>, String> {
    let Some(matcher) = build_matcher(spec)? else {
        return Ok(Vec::new());
    };
    let column_indices = matching_column_indices(dataset, spec);
    Ok(dataset
        .view
        .iter()
        .copied()
        .filter(|row_index| {
            column_indices.iter().any(|column_index| {
                matcher.is_match(dataset.rows.cell(*row_index as usize, *column_index))
            })
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

fn infer_column_types(rows: &PackedRows, column_count: usize) -> Vec<String> {
    (0..column_count)
        .map(|column_index| {
            let values = (0..rows.len().min(TYPE_INFERENCE_ROWS))
                .map(|row_index| rows.cell(row_index, column_index).trim())
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
                if counts.len() <= CATEGORY_MAX_DISTINCT_VALUES
                    && counts.len() * CATEGORY_MAX_DISTINCT_RATIO <= values.len()
                {
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
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
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
                rows.cell(*a as usize, *column_index),
                rows.cell(*b as usize, *column_index),
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
            let value = dataset.rows.cell(*source_row as usize, *column_index);
            if matcher.is_match(value) {
                dataset.search_matches.push((
                    RowIndex::try_from(row_index).expect("row limit fits in u32"),
                    ColumnIndex::try_from(*column_index).expect("column limit fits in u32"),
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn open_csv_dialog(
    separator: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedSheet>, String> {
    let separator = separator_byte(&separator)?;
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    let path_string = path.to_string_lossy().into_owned();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Selected CSV has no valid filename")?
        .to_owned();
    let metadata = insert_dataset(read_dataset(&path_string, separator)?, &state)?;
    Ok(Some(OpenedSheet {
        filename,
        path: path_string,
        metadata,
    }))
}

#[tauri::command]
async fn load_indexed_csv_file(
    token: String,
    separator: String,
    state: State<'_, AppState>,
) -> Result<OpenedSheet, String> {
    let path = state
        .indexed_paths
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&token)
        .ok_or("File selection expired")?;
    let separator = separator_byte(&separator)?;
    let path_string = path.to_string_lossy().into_owned();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Indexed CSV has no valid filename")?
        .to_owned();
    let metadata = insert_dataset(read_dataset(&path_string, separator)?, &state)?;
    Ok(OpenedSheet {
        filename,
        path: path_string,
        metadata,
    })
}

#[tauri::command]
async fn rescan_csv_file(
    dataset_id: String,
    separator: String,
    state: State<'_, AppState>,
) -> Result<Vec<SheetMetadata>, String> {
    let separator = separator_byte(&separator)?;
    let root_handle = dataset(&state, &dataset_id)?;
    let path = lock_dataset(&root_handle)?
        .source_path
        .clone()
        .ok_or("Dataset has no source path")?;
    let mut root = read_dataset(&path.to_string_lossy(), separator)?;
    let candidates = {
        let store = datasets(&state)?;
        store
            .iter()
            .map(|(id, handle)| (id.clone(), Arc::clone(handle)))
            .collect::<Vec<_>>()
    };
    let mut children = Vec::new();
    for (id, handle) in candidates {
        let child = lock_dataset(&handle)?;
        if child.source_id.as_deref() == Some(&dataset_id) {
            children.push((id, child.filter.clone(), child.sorting.clone()));
        }
    }
    root.sorting = lock_dataset(&root_handle)?.sorting.clone();
    apply_sort(&mut root);
    let mut replacements = vec![(dataset_id.clone(), root.clone())];
    for (child_id, filter, sorting) in children {
        let filter = filter.ok_or("Filtered dataset is missing its filter")?;
        let view = matching_rows(&root, &filter)?;
        let mut child = Dataset {
            columns: root.columns.clone(),
            rows: Arc::clone(&root.rows),
            order: view.clone(),
            view,
            column_types: root.column_types.clone(),
            separator: root.separator,
            size_bytes: 0,
            source_id: Some(dataset_id.clone()),
            filter: Some(filter),
            sorting,
            search: None,
            search_matches: Vec::new(),
            source_path: None,
        };
        apply_sort(&mut child);
        replacements.push((child_id, child));
    }
    let metadata_list = replacements
        .iter()
        .map(|(id, dataset)| metadata(id, dataset))
        .collect();
    let mut store = datasets(&state)?;
    for (id, replacement) in replacements {
        store.insert(id, Arc::new(Mutex::new(replacement)));
    }
    Ok(metadata_list)
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
    let source_handle = dataset(&state, &source_id)?;
    let source = lock_dataset(&source_handle)?;
    let view = matching_rows(&source, &filter)?;
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
        source_path: None,
    };
    let result = metadata(&id, &dataset);
    drop(source);
    datasets(&state)?.insert(id, Arc::new(Mutex::new(dataset)));
    Ok(Some(result))
}

#[tauri::command]
fn close_dataset(dataset_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let candidates = {
        let store = datasets(&state)?;
        store
            .iter()
            .map(|(id, handle)| (id.clone(), Arc::clone(handle)))
            .collect::<Vec<_>>()
    };
    let mut children = Vec::new();
    for (id, handle) in candidates {
        if lock_dataset(&handle)?.source_id.as_deref() == Some(&dataset_id) {
            children.push(id);
        }
    }
    let mut store = datasets(&state)?;
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
    let handle = dataset(&state, &dataset_id)?;
    let dataset = lock_dataset(&handle)?;
    let rows = dataset
        .order
        .iter()
        .skip(offset)
        .take(limit)
        .map(|row_index| dataset.rows.row_owned(*row_index as usize))
        .collect();
    let end = offset + limit;
    let matches = dataset
        .search_matches
        .iter()
        .filter(|(row_index, _)| {
            let row_index = *row_index as usize;
            row_index >= offset && row_index < end
        })
        .map(|(row_index, column_index)| SearchMatch {
            row_index: *row_index as usize,
            column_id: dataset.columns[*column_index as usize].clone(),
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
    let handle = dataset(&state, &dataset_id)?;
    let mut dataset = lock_dataset(&handle)?;
    dataset.sorting = sorting;
    apply_sort(&mut dataset);
    apply_search(&mut dataset)?;
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
    let handle = dataset(&state, &dataset_id)?;
    let mut dataset = lock_dataset(&handle)?;
    dataset.search = Some(spec);
    apply_search(&mut dataset)?;
    Ok(dataset.search_matches.len())
}

#[tauri::command]
async fn get_search_match(
    dataset_id: String,
    index: usize,
    state: State<'_, AppState>,
) -> Result<Option<SearchMatch>, String> {
    let handle = dataset(&state, &dataset_id)?;
    let dataset = lock_dataset(&handle)?;
    Ok(dataset
        .search_matches
        .get(index)
        .map(|(row_index, column_index)| SearchMatch {
            row_index: *row_index as usize,
            column_id: dataset.columns[*column_index as usize].clone(),
        }))
}

#[tauri::command]
async fn get_column_stats(
    dataset_id: String,
    column: String,
    column_type: String,
    state: State<'_, AppState>,
) -> Result<Option<ColumnStats>, String> {
    let handle = dataset(&state, &dataset_id)?;
    let dataset = lock_dataset(&handle)?.clone();
    let column_index = dataset
        .columns
        .iter()
        .position(|name| name == &column)
        .ok_or("Column not found")?;
    let values = dataset
        .view
        .iter()
        .map(|row_index| dataset.rows.cell(*row_index as usize, column_index))
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
                .map(|value| (value - avg).powi(VARIANCE_POWER))
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
    let handle = dataset(&state, &dataset_id)?;
    let dataset = lock_dataset(&handle)?.clone();
    if dataset.order.len() > MAX_CHART_POINTS {
        return Err(format!(
            "Chart data has {} rows; the limit is {MAX_CHART_POINTS}",
            dataset.order.len()
        ));
    }
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
            .map(|row| dataset.rows.cell(*row as usize, index).to_owned())
            .collect()
    };
    Ok(ChartData {
        x_values: column_values(x_index),
        y_values: y_index.map(column_values),
        group_values: group_index.map(column_values),
    })
}

#[tauri::command]
async fn save_csv_file_dialog(
    dataset_id: String,
    default_name: String,
    columns: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    let path = path.to_string_lossy().into_owned();
    validate_csv_path(&path)?;
    let handle = dataset(&state, &dataset_id)?;
    let dataset = lock_dataset(&handle)?.clone();
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
                    .map(|column_index| dataset.rows.cell(*row_index as usize, *column_index)),
            )
            .map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn list_csv_files(state: State<'_, AppState>) -> Result<Vec<FileCandidate>, String> {
    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    let output = std::process::Command::new("fd")
        .args([
            "--type",
            "f",
            "--extension",
            "csv",
            "--max-results",
            MAX_INDEXED_FILES,
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
    let mut indexed_paths = state
        .indexed_paths
        .lock()
        .map_err(|error| error.to_string())?;
    indexed_paths.clear();
    let mut candidates = Vec::new();
    for path in String::from_utf8_lossy(&output.stdout).lines() {
        let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let token = state
            .next_path_token
            .fetch_add(1, AtomicOrdering::Relaxed)
            .to_string();
        candidates.push(FileCandidate {
            token: token.clone(),
            path: path.to_string_lossy().into_owned(),
        });
        indexed_paths.insert(token, path);
    }
    Ok(candidates)
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
        .invoke_handler(tauri::generate_handler![
            open_csv_dialog,
            load_indexed_csv_file,
            rescan_csv_file,
            create_filtered_dataset,
            close_dataset,
            get_rows,
            sort_dataset,
            search_dataset,
            get_search_match,
            get_column_stats,
            get_chart_data,
            save_csv_file_dialog,
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

    fn packed_rows(records: &[&[&str]]) -> PackedRows {
        let column_count = records.first().map_or(0, |record| record.len());
        let mut rows = PackedRows::with_capacity(column_count, 0);
        for record in records {
            rows.push_record(&csv::StringRecord::from(record.to_vec()))
                .expect("pack row");
        }
        rows.shrink_to_fit();
        rows
    }

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
        assert_eq!(dataset.rows.cell(1, 0), "Bob");
        assert_eq!(
            dataset.column_types,
            ["string", "uuid", "number", "boolean"]
        );
    }

    #[test]
    fn rejects_duplicate_headers() {
        let path = std::env::temp_dir().join(format!(
            "coccinella-duplicate-headers-{}.csv",
            std::process::id()
        ));
        std::fs::write(&path, "name,name (2),name\nAda,Lovelace,Byron\n").expect("write fixture");

        let error = read_dataset(path.to_str().expect("UTF-8 path"), b',')
            .err()
            .expect("reject duplicate headers");
        std::fs::remove_file(path).expect("remove fixture");

        assert!(error.contains("duplicated"));
    }

    #[test]
    fn rejects_irregular_rows() {
        let path = std::env::temp_dir().join(format!(
            "coccinella-irregular-row-{}.csv",
            std::process::id()
        ));
        std::fs::write(&path, "name,score\nAda,10,extra\n").expect("write fixture");

        let error = read_dataset(path.to_str().expect("UTF-8 path"), b',')
            .err()
            .expect("reject irregular row");
        std::fs::remove_file(path).expect("remove fixture");

        assert!(error.contains("found record with 3 fields"));
    }

    #[test]
    fn rejects_dates_with_trailing_content() {
        assert!(parse_date("2026-09-17").is_some());
        assert!(parse_date("2026-09-17 garbage").is_none());
    }

    #[test]
    fn packs_cells_into_one_text_allocation_with_compact_offsets() {
        let rows = packed_rows(&[&["Ada", "10"], &["Bob", "20"], &["Adam", "15"]]);

        assert_eq!(rows.data, "Ada10Bob20Adam15");
        assert_eq!(rows.cell_offsets, [0, 3, 5, 8, 10, 14, 16]);
        assert_eq!(rows.row_offsets, [0, 5, 10, 16]);
        assert_eq!(rows.row_owned(2), ["Adam", "15"]);
        let offset_bytes =
            (rows.cell_offsets.len() + rows.row_offsets.len()) * std::mem::size_of::<u32>();
        let individual_string_metadata_bytes =
            rows.column_count * rows.len() * std::mem::size_of::<String>();
        assert!(offset_bytes < individual_string_metadata_bytes);
    }

    #[test]
    fn packed_storage_avoids_per_cell_string_metadata() {
        let column_count = 100;
        let row_count = 1_000;
        let record = csv::StringRecord::from(vec!["x"; column_count]);
        let mut rows = PackedRows::with_capacity(column_count, row_count * column_count);
        for _ in 0..row_count {
            rows.push_record(&record).expect("pack row");
        }
        rows.shrink_to_fit();

        let individual_string_metadata_bytes =
            row_count * column_count * std::mem::size_of::<String>();
        assert!(rows.allocated_bytes() * 4 < individual_string_metadata_bytes);
        assert_eq!(rows.cell(row_count - 1, column_count - 1), "x");
    }

    #[test]
    fn filters_sorts_and_indexes_search_matches() {
        let mut dataset = Dataset {
            columns: vec!["name".into(), "score".into()],
            rows: Arc::new(packed_rows(&[
                &["Ada", "10"],
                &["Bob", "20"],
                &["Adam", "15"],
            ])),
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
            source_path: None,
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
