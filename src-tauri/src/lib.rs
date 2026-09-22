// Owns CSV data and exposes paged operations to the Tauri frontend.
// FEATURE: CSV data workspace
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use nucleo_matcher::{
    pattern::{AtomKind, CaseMatching, Normalization, Pattern},
    Config as FuzzyConfig, Matcher as FuzzyMatcher, Utf32Str,
};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_CSV_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 1_000_000;
const MAX_CSV_FIELDS: usize = 10_000_000;
const MAX_CSV_COLUMNS: usize = 10_000;
const TYPE_INFERENCE_ROWS: usize = 10_000;
const MAX_CHART_POINTS: usize = 100_000;
const MAX_INDEXED_FILES: usize = 1_000;
const FILE_DISCOVERY_BATCH_SIZE: usize = 50;
const EXCLUDED_SEARCH_DIRECTORIES: [&str; 5] = [
    "Library",
    "Applications",
    "Dropbox",
    "Google Drive",
    "OneDrive",
];
#[cfg(target_os = "macos")]
const MACOS_PROTECTED_DIRECTORIES: [&str; 3] = ["Music", "Movies", "Pictures"];
const CATEGORY_MAX_DISTINCT_VALUES: usize = 20;
const CATEGORY_MAX_DISTINCT_RATIO: usize = 2;
const VARIANCE_POWER: i32 = 2;
const GENERATION_STEP: u64 = 1;

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
    pending_open_files: Mutex<Vec<FileCandidate>>,
}

#[derive(Clone)]
struct Dataset {
    columns: Vec<String>,
    rows: Arc<PackedRows>,
    view: Arc<Vec<RowIndex>>,
    order: Arc<Vec<RowIndex>>,
    column_types: Vec<String>,
    separator: u8,
    size_bytes: u64,
    source_id: Option<String>,
    filter: Option<FilterSpec>,
    sorting: Vec<SortSpec>,
    search: Option<FilterSpec>,
    search_matches: Vec<(RowIndex, ColumnIndex)>,
    sort_generation: u64,
    search_generation: u64,
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

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum JoinType {
    Left,
    Right,
    Inner,
}

struct JoinSource {
    columns: Vec<String>,
    rows: Arc<PackedRows>,
    order: Arc<Vec<RowIndex>>,
    column_types: Vec<String>,
    separator: u8,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AggregationSpec {
    column: String,
    function: String,
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
    null_count: usize,
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
    y_values: Vec<Vec<String>>,
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
#[serde(rename_all = "camelCase")]
struct FuzzyMatch {
    text: String,
    indices: Vec<u32>,
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

enum SortKeys {
    Number(Vec<Option<f64>>),
    Date(Vec<Option<NaiveDate>>),
    Uuid(Vec<Option<[u8; 16]>>),
    Boolean(Vec<bool>),
    Text(Vec<String>),
}

impl SortKeys {
    fn compare(&self, a: usize, b: usize) -> Ordering {
        match self {
            Self::Number(values) => match (values[a], values[b]) {
                (Some(a), Some(b)) => a.partial_cmp(&b).unwrap_or(Ordering::Equal),
                (None, Some(_)) => Ordering::Less,
                (Some(_), None) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            },
            Self::Date(values) => compare_optional(&values[a], &values[b]),
            Self::Uuid(values) => compare_optional(&values[a], &values[b]),
            Self::Boolean(values) => values[a].cmp(&values[b]),
            Self::Text(values) => values[a].cmp(&values[b]),
        }
    }
}

fn compare_optional<T: Ord>(a: &Option<T>, b: &Option<T>) -> Ordering {
    a.cmp(b)
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

#[cfg(target_os = "macos")]
fn queue_opened_csv_files(urls: &[tauri::Url], state: &AppState) -> Result<usize, String> {
    let paths = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| validate_csv_path(&path.to_string_lossy()).is_ok())
        .collect::<Vec<_>>();
    let mut indexed_paths = state
        .indexed_paths
        .lock()
        .map_err(|error| error.to_string())?;
    let mut pending_open_files = state
        .pending_open_files
        .lock()
        .map_err(|error| error.to_string())?;

    for path in paths {
        let token = state
            .next_path_token
            .fetch_add(1, AtomicOrdering::Relaxed)
            .to_string();
        pending_open_files.push(FileCandidate {
            token: token.clone(),
            path: path.to_string_lossy().into_owned(),
        });
        indexed_paths.insert(token, path);
    }
    Ok(pending_open_files.len())
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
    let view = Arc::new(view);
    Ok(Dataset {
        columns,
        rows: Arc::new(rows),
        order: Arc::clone(&view),
        view,
        column_types,
        separator,
        size_bytes,
        source_id: None,
        filter: None,
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
        sort_generation: 0,
        search_generation: 0,
        source_path: Some(std::fs::canonicalize(path).map_err(|error| error.to_string())?),
    })
}

async fn read_dataset_blocking(path: String, separator: u8) -> Result<Dataset, String> {
    tauri::async_runtime::spawn_blocking(move || read_dataset(&path, separator))
        .await
        .map_err(|error| error.to_string())?
}

fn metadata(id: &str, dataset: &Dataset) -> SheetMetadata {
    let column_count = dataset.columns.len();
    let null_count = dataset
        .view
        .iter()
        .map(|row_index| {
            (0..column_count)
                .filter(|column_index| {
                    dataset
                        .rows
                        .cell(*row_index as usize, *column_index)
                        .is_empty()
                })
                .count()
        })
        .sum();
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
        null_count,
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
    Ok(collect_matching_rows(
        &dataset.rows,
        &dataset.view,
        &matcher,
        &column_indices,
    ))
}

fn collect_matching_rows(
    rows: &PackedRows,
    view: &[RowIndex],
    matcher: &Matcher,
    column_indices: &[usize],
) -> Vec<RowIndex> {
    view.iter()
        .copied()
        .filter(|row_index| {
            column_indices
                .iter()
                .any(|column_index| matcher.is_match(rows.cell(*row_index as usize, *column_index)))
        })
        .collect()
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

fn join_key<'a>(
    rows: &'a PackedRows,
    row_index: RowIndex,
    column_indices: &[usize],
) -> Option<Vec<&'a str>> {
    column_indices
        .iter()
        .map(|column_index| {
            let value = rows.cell(row_index as usize, *column_index);
            (!value.is_empty()).then_some(value)
        })
        .collect()
}

fn join_datasets(
    left: JoinSource,
    right: JoinSource,
    columns: &[String],
    join_type: JoinType,
) -> Result<Dataset, String> {
    if columns.is_empty() {
        return Err("Select at least one column to merge on".into());
    }
    let column_index = |source: &JoinSource, column: &str| {
        source
            .columns
            .iter()
            .position(|candidate| candidate == column)
            .ok_or_else(|| format!("Column not found: {column}"))
    };
    let left_keys = columns
        .iter()
        .map(|column| column_index(&left, column))
        .collect::<Result<Vec<_>, _>>()?;
    let right_keys = columns
        .iter()
        .map(|column| column_index(&right, column))
        .collect::<Result<Vec<_>, _>>()?;
    let right_key_set = right_keys.iter().copied().collect::<HashSet<_>>();
    let right_output_indices = (0..right.columns.len())
        .filter(|index| !right_key_set.contains(index))
        .collect::<Vec<_>>();

    let mut output_columns = left.columns.clone();
    let mut used_columns = output_columns.iter().cloned().collect::<HashSet<_>>();
    for right_index in &right_output_indices {
        let base = &right.columns[*right_index];
        let mut output = base.clone();
        let mut suffix = 2;
        if used_columns.contains(&output) {
            output = format!("{base} (right)");
        }
        while used_columns.contains(&output) {
            output = format!("{base} (right {suffix})");
            suffix += 1;
        }
        used_columns.insert(output.clone());
        output_columns.push(output);
    }
    if output_columns.len() > MAX_CSV_COLUMNS {
        return Err(format!(
            "Merged data exceeds the {MAX_CSV_COLUMNS}-column limit"
        ));
    }

    let mut right_index = HashMap::<Vec<&str>, Vec<RowIndex>>::new();
    for row_index in right.order.iter().copied() {
        if let Some(key) = join_key(&right.rows, row_index, &right_keys) {
            right_index.entry(key).or_default().push(row_index);
        }
    }

    let mut rows = PackedRows::with_capacity(output_columns.len(), 0);
    let mut field_count = output_columns.len();
    let mut matched_right = HashSet::new();
    let left_key_positions = left_keys
        .iter()
        .enumerate()
        .map(|(position, column_index)| (*column_index, position))
        .collect::<HashMap<_, _>>();
    let mut push_row = |left_row: Option<RowIndex>, right_row: Option<RowIndex>| {
        if rows.len() >= MAX_CSV_ROWS {
            return Err(format!("Merged data exceeds the {MAX_CSV_ROWS}-row limit"));
        }
        field_count += output_columns.len();
        if field_count > MAX_CSV_FIELDS {
            return Err(format!(
                "Merged data exceeds the {MAX_CSV_FIELDS}-field limit"
            ));
        }
        let mut record = csv::StringRecord::new();
        for left_index in 0..left.columns.len() {
            let value = match (left_row, right_row, left_key_positions.get(&left_index)) {
                (Some(row_index), _, _) => left.rows.cell(row_index as usize, left_index),
                (None, Some(row_index), Some(key_position)) => right
                    .rows
                    .cell(row_index as usize, right_keys[*key_position]),
                _ => "",
            };
            record.push_field(value);
        }
        for right_index in &right_output_indices {
            let value = right_row
                .map(|row_index| right.rows.cell(row_index as usize, *right_index))
                .unwrap_or("");
            record.push_field(value);
        }
        rows.push_record(&record)
    };

    for left_row in left.order.iter().copied() {
        let matches =
            join_key(&left.rows, left_row, &left_keys).and_then(|key| right_index.get(&key));
        if let Some(matches) = matches {
            for right_row in matches {
                push_row(Some(left_row), Some(*right_row))?;
                matched_right.insert(*right_row);
            }
        } else if join_type == JoinType::Left {
            push_row(Some(left_row), None)?;
        }
    }
    if join_type == JoinType::Right {
        for right_row in right.order.iter().copied() {
            if !matched_right.contains(&right_row) {
                push_row(None, Some(right_row))?;
            }
        }
    }

    rows.shrink_to_fit();
    let column_types = left
        .column_types
        .iter()
        .cloned()
        .chain(
            right_output_indices
                .iter()
                .map(|index| right.column_types[*index].clone()),
        )
        .collect();
    let view = Arc::new(
        (0..rows.len())
            .map(|index| RowIndex::try_from(index).expect("row limit fits in u32"))
            .collect::<Vec<_>>(),
    );
    Ok(Dataset {
        columns: output_columns,
        rows: Arc::new(rows),
        order: Arc::clone(&view),
        view,
        column_types,
        separator: left.separator,
        size_bytes: 0,
        source_id: None,
        filter: None,
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
        sort_generation: 0,
        search_generation: 0,
        source_path: None,
    })
}

fn derived_dataset(
    columns: Vec<String>,
    mut rows: PackedRows,
    column_types: Vec<String>,
    separator: u8,
) -> Dataset {
    rows.shrink_to_fit();
    let view = Arc::new(
        (0..rows.len())
            .map(|index| RowIndex::try_from(index).expect("row limit fits in u32"))
            .collect::<Vec<_>>(),
    );
    Dataset {
        columns,
        rows: Arc::new(rows),
        order: Arc::clone(&view),
        view,
        column_types,
        separator,
        size_bytes: 0,
        source_id: None,
        filter: None,
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
        sort_generation: 0,
        search_generation: 0,
        source_path: None,
    }
}

fn append_datasets(sources: Vec<JoinSource>) -> Result<Dataset, String> {
    let Some(first) = sources.first() else {
        return Err("Select at least two datasets to append".into());
    };
    if sources.len() < 2 {
        return Err("Select at least two datasets to append".into());
    }
    if sources.iter().any(|source| source.columns != first.columns) {
        return Err("Appended datasets must have exactly the same columns".into());
    }
    let row_count = sources
        .iter()
        .map(|source| source.order.len())
        .sum::<usize>();
    if row_count > MAX_CSV_ROWS {
        return Err(format!(
            "Appended data exceeds the {MAX_CSV_ROWS}-row limit"
        ));
    }
    if first.columns.len().saturating_mul(row_count + 1) > MAX_CSV_FIELDS {
        return Err(format!(
            "Appended data exceeds the {MAX_CSV_FIELDS}-field limit"
        ));
    }
    let mut rows = PackedRows::with_capacity(first.columns.len(), 0);
    for source in &sources {
        for row_index in source.order.iter() {
            rows.push_record(&csv::StringRecord::from(
                (0..source.columns.len())
                    .map(|column_index| source.rows.cell(*row_index as usize, column_index))
                    .collect::<Vec<_>>(),
            ))?;
        }
    }
    let column_types = infer_column_types(&rows, first.columns.len());
    Ok(derived_dataset(
        first.columns.clone(),
        rows,
        column_types,
        first.separator,
    ))
}

fn aggregate_value(
    source: &JoinSource,
    rows: &[RowIndex],
    column_index: usize,
    function: &str,
) -> Result<String, String> {
    let values = rows
        .iter()
        .map(|row| source.rows.cell(*row as usize, column_index))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    match function {
        "count" => Ok(values.len().to_string()),
        "count_distinct" => Ok(values
            .iter()
            .copied()
            .collect::<HashSet<_>>()
            .len()
            .to_string()),
        "mode" => {
            let mut counts = HashMap::<&str, usize>::new();
            for value in values {
                *counts.entry(value).or_default() += 1;
            }
            Ok(counts
                .into_iter()
                .max_by(|(left_value, left_count), (right_value, right_count)| {
                    left_count
                        .cmp(right_count)
                        .then_with(|| right_value.cmp(left_value))
                })
                .map(|(value, _)| value.to_owned())
                .unwrap_or_default())
        }
        "min" | "max" if source.column_types[column_index] == "number" => {
            let numbers = values
                .iter()
                .map(|value| {
                    value
                        .parse::<f64>()
                        .map_err(|_| format!("Invalid number: {value}"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let selected = if function == "min" {
                numbers.into_iter().reduce(f64::min)
            } else {
                numbers.into_iter().reduce(f64::max)
            };
            Ok(selected.map(|value| value.to_string()).unwrap_or_default())
        }
        "min" | "max" if source.column_types[column_index] == "date" => {
            let mut dated = values
                .iter()
                .map(|value| {
                    parse_date(value)
                        .map(|date| (date, *value))
                        .ok_or_else(|| format!("Invalid date: {value}"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            dated.sort_by_key(|(date, _)| *date);
            Ok(if function == "min" {
                dated.first()
            } else {
                dated.last()
            }
            .map(|(_, value)| (*value).to_owned())
            .unwrap_or_default())
        }
        "sum" | "mean" | "standard_deviation" if source.column_types[column_index] == "number" => {
            let numbers = values
                .iter()
                .map(|value| {
                    value
                        .parse::<f64>()
                        .map_err(|_| format!("Invalid number: {value}"))
                })
                .collect::<Result<Vec<_>, _>>()?;
            if numbers.is_empty() {
                return Ok(String::new());
            }
            let sum = numbers.iter().sum::<f64>();
            let value = match function {
                "sum" => sum,
                "mean" => sum / numbers.len() as f64,
                _ => {
                    let mean = sum / numbers.len() as f64;
                    (numbers
                        .iter()
                        .map(|value| (value - mean).powi(2))
                        .sum::<f64>()
                        / numbers.len() as f64)
                        .sqrt()
                }
            };
            Ok(value.to_string())
        }
        _ => Err(format!(
            "Aggregation {function} is not supported for {} columns",
            source.column_types[column_index]
        )),
    }
}

fn aggregate_dataset(
    source: JoinSource,
    aggregations: &[AggregationSpec],
    group_by: &[String],
) -> Result<Dataset, String> {
    if aggregations.is_empty() {
        return Err("Select at least one column to aggregate".into());
    }
    let column_index = |column: &str| {
        source
            .columns
            .iter()
            .position(|candidate| candidate == column)
            .ok_or_else(|| format!("Column not found: {column}"))
    };
    let group_indices = group_by
        .iter()
        .map(|column| column_index(column))
        .collect::<Result<Vec<_>, _>>()?;
    let aggregation_indices = aggregations
        .iter()
        .map(|spec| column_index(&spec.column))
        .collect::<Result<Vec<_>, _>>()?;
    if group_indices
        .iter()
        .any(|index| aggregation_indices.contains(index))
    {
        return Err("Group-by columns cannot also be aggregated".into());
    }
    let mut grouped = Vec::<(Vec<String>, Vec<RowIndex>)>::new();
    let mut positions = HashMap::<Vec<String>, usize>::new();
    if group_indices.is_empty() {
        grouped.push((Vec::new(), Vec::new()));
        positions.insert(Vec::new(), 0);
    }
    for row in source.order.iter().copied() {
        let key = group_indices
            .iter()
            .map(|index| source.rows.cell(row as usize, *index).to_owned())
            .collect::<Vec<_>>();
        let position = match positions.get(&key) {
            Some(position) => *position,
            None => {
                let position = grouped.len();
                positions.insert(key.clone(), position);
                grouped.push((key, Vec::new()));
                position
            }
        };
        grouped[position].1.push(row);
    }
    let output_columns = group_by
        .iter()
        .cloned()
        .chain(
            aggregations
                .iter()
                .map(|spec| format!("{} of {}", spec.function.replace('_', " "), spec.column)),
        )
        .collect::<Vec<_>>();
    let mut rows = PackedRows::with_capacity(output_columns.len(), 0);
    for (key, group_rows) in grouped {
        let mut record = csv::StringRecord::from(key);
        for (spec, column_index) in aggregations.iter().zip(&aggregation_indices) {
            record.push_field(&aggregate_value(
                &source,
                &group_rows,
                *column_index,
                &spec.function,
            )?);
        }
        rows.push_record(&record)?;
    }
    let mut column_types = group_indices
        .iter()
        .map(|index| source.column_types[*index].clone())
        .collect::<Vec<_>>();
    column_types.extend(
        aggregations
            .iter()
            .zip(&aggregation_indices)
            .map(|(spec, index)| match spec.function.as_str() {
                "mode" | "min" | "max" => source.column_types[*index].clone(),
                _ => "number".to_owned(),
            }),
    );
    Ok(derived_dataset(
        output_columns,
        rows,
        column_types,
        source.separator,
    ))
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
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .or_else(|| {
            DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|date_time| date_time.date_naive())
        })
        .or_else(|| {
            DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f%:z")
                .ok()
                .map(|date_time| date_time.date_naive())
        })
        .or_else(|| {
            ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f"]
                .iter()
                .find_map(|format| NaiveDateTime::parse_from_str(value, format).ok())
                .map(|date_time| date_time.date())
        })
}

fn sort_columns(dataset: &Dataset, sorting: &[SortSpec]) -> Vec<(usize, SortSpec)> {
    sorting
        .iter()
        .filter_map(|sort| {
            dataset
                .columns
                .iter()
                .position(|column| column == &sort.id)
                .map(|index| (index, sort.clone()))
        })
        .collect()
}

fn sort_rows(rows: &PackedRows, view: &[RowIndex], columns: &[(usize, SortSpec)]) -> Vec<RowIndex> {
    if columns.is_empty() {
        return view.to_vec();
    }
    let keys = columns
        .iter()
        .map(|(column_index, sort)| {
            let values = || {
                view.iter()
                    .map(|row| rows.cell(*row as usize, *column_index))
            };
            match sort.column_type.as_str() {
                "number" => SortKeys::Number(
                    values()
                        .map(|value| value.parse::<f64>().ok().filter(|value| value.is_finite()))
                        .collect(),
                ),
                "date" => SortKeys::Date(values().map(parse_date).collect()),
                "uuid" => SortKeys::Uuid(
                    values()
                        .map(|value| Uuid::parse_str(value).ok().map(|uuid| *uuid.as_bytes()))
                        .collect(),
                ),
                "boolean" => SortKeys::Boolean(
                    values()
                        .map(|value| value.eq_ignore_ascii_case("true"))
                        .collect(),
                ),
                _ => SortKeys::Text(values().map(str::to_lowercase).collect()),
            }
        })
        .collect::<Vec<_>>();
    let mut positions = (0..view.len()).collect::<Vec<_>>();
    positions.sort_unstable_by(|a, b| {
        for (keys, (_, sort)) in keys.iter().zip(columns) {
            let ordering = keys.compare(*a, *b);
            if ordering != Ordering::Equal {
                return if sort.desc {
                    ordering.reverse()
                } else {
                    ordering
                };
            }
        }
        view[*a].cmp(&view[*b])
    });
    positions.into_iter().map(|index| view[index]).collect()
}

async fn sort_rows_blocking(
    rows: Arc<PackedRows>,
    view: Arc<Vec<RowIndex>>,
    columns: Vec<(usize, SortSpec)>,
) -> Result<Vec<RowIndex>, String> {
    tauri::async_runtime::spawn_blocking(move || sort_rows(&rows, &view, &columns))
        .await
        .map_err(|error| error.to_string())
}

fn collect_search_matches(
    rows: &PackedRows,
    order: &[RowIndex],
    matcher: &Matcher,
    column_indices: &[usize],
) -> Vec<(RowIndex, ColumnIndex)> {
    let mut matches = Vec::new();
    for (row_index, source_row) in order.iter().enumerate() {
        for column_index in column_indices {
            let value = rows.cell(*source_row as usize, *column_index);
            if matcher.is_match(value) {
                matches.push((
                    RowIndex::try_from(row_index).expect("row limit fits in u32"),
                    ColumnIndex::try_from(*column_index).expect("column limit fits in u32"),
                ));
            }
        }
    }
    matches
}

fn commit_sort(
    dataset: &mut Dataset,
    generation: u64,
    sorting: Vec<SortSpec>,
    order: Vec<RowIndex>,
) -> bool {
    if dataset.sort_generation != generation {
        return false;
    }
    dataset.sorting = sorting;
    dataset.order = Arc::new(order);
    dataset.search_generation = dataset.search_generation.wrapping_add(GENERATION_STEP);
    dataset.search_matches.clear();
    true
}

fn commit_search(
    dataset: &mut Dataset,
    generation: u64,
    order: &Arc<Vec<RowIndex>>,
    matches: Vec<(RowIndex, ColumnIndex)>,
) -> bool {
    if dataset.search_generation != generation || !Arc::ptr_eq(&dataset.order, order) {
        return false;
    }
    dataset.search_matches = matches;
    true
}

#[tauri::command]
async fn open_csv_dialog(
    separator: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedSheet>, String> {
    let separator = separator_byte(&separator)?;
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(file) = file else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    let path_string = path.to_string_lossy().into_owned();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Selected CSV has no valid filename")?
        .to_owned();
    let dataset = read_dataset_blocking(path_string.clone(), separator).await?;
    let metadata = insert_dataset(dataset, &state)?;
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
    let dataset = read_dataset_blocking(path_string.clone(), separator).await?;
    let metadata = insert_dataset(dataset, &state)?;
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
    let mut root = read_dataset_blocking(path.to_string_lossy().into_owned(), separator).await?;
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
            children.push((
                id,
                Arc::clone(&handle),
                child.filter.clone(),
                child.sorting.clone(),
            ));
        }
    }
    root.sorting = lock_dataset(&root_handle)?.sorting.clone();
    let columns = sort_columns(&root, &root.sorting);
    root.order = Arc::new(
        sort_rows_blocking(Arc::clone(&root.rows), Arc::clone(&root.view), columns).await?,
    );
    let mut replacements = vec![(dataset_id.clone(), Arc::clone(&root_handle), root.clone())];
    for (child_id, handle, filter, sorting) in children {
        let filter = filter.ok_or("Filtered dataset is missing its filter")?;
        let view = matching_rows(&root, &filter)?;
        let view = Arc::new(view);
        let mut child = Dataset {
            columns: root.columns.clone(),
            rows: Arc::clone(&root.rows),
            order: Arc::clone(&view),
            view,
            column_types: root.column_types.clone(),
            separator: root.separator,
            size_bytes: 0,
            source_id: Some(dataset_id.clone()),
            filter: Some(filter),
            sorting,
            search: None,
            search_matches: Vec::new(),
            sort_generation: 0,
            search_generation: 0,
            source_path: None,
        };
        let columns = sort_columns(&child, &child.sorting);
        child.order = Arc::new(
            sort_rows_blocking(Arc::clone(&child.rows), Arc::clone(&child.view), columns).await?,
        );
        replacements.push((child_id, handle, child));
    }
    let metadata_list = replacements
        .iter()
        .map(|(id, _, dataset)| metadata(id, dataset))
        .collect();
    for (_, handle, replacement) in replacements {
        let mut existing = lock_dataset(&handle)?;
        let sort_generation = existing.sort_generation.wrapping_add(GENERATION_STEP);
        let search_generation = existing.search_generation.wrapping_add(GENERATION_STEP);
        *existing = Dataset {
            sort_generation,
            search_generation,
            ..replacement
        };
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
    let Some(matcher) = build_matcher(&filter)? else {
        return Ok(None);
    };
    let source_handle = dataset(&state, &source_id)?;
    let (rows, source_view, column_indices, source_columns, column_types, separator) = {
        let source = lock_dataset(&source_handle)?;
        (
            Arc::clone(&source.rows),
            Arc::clone(&source.view),
            matching_column_indices(&source, &filter),
            source.columns.clone(),
            source.column_types.clone(),
            source.separator,
        )
    };
    let rows_for_filter = Arc::clone(&rows);
    let view = tauri::async_runtime::spawn_blocking(move || {
        collect_matching_rows(&rows_for_filter, &source_view, &matcher, &column_indices)
    })
    .await
    .map_err(|error| error.to_string())?;
    if view.is_empty() {
        return Ok(None);
    }
    let id = state
        .next_dataset_id
        .fetch_add(1, AtomicOrdering::Relaxed)
        .to_string();
    let view = Arc::new(view);
    let dataset = Dataset {
        columns: source_columns,
        rows,
        order: Arc::clone(&view),
        view,
        column_types,
        separator,
        size_bytes: 0,
        source_id: Some(source_id),
        filter: Some(filter),
        sorting: Vec::new(),
        search: None,
        search_matches: Vec::new(),
        sort_generation: 0,
        search_generation: 0,
        source_path: None,
    };
    let result = metadata(&id, &dataset);
    datasets(&state)?.insert(id, Arc::new(Mutex::new(dataset)));
    Ok(Some(result))
}

#[tauri::command]
async fn create_joined_dataset(
    left_id: String,
    right_id: String,
    columns: Vec<String>,
    join_type: JoinType,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    if left_id == right_id {
        return Err("Select two different datasets".into());
    }
    let source = |id: &str| -> Result<JoinSource, String> {
        let handle = dataset(&state, id)?;
        let dataset = lock_dataset(&handle)?;
        Ok(JoinSource {
            columns: dataset.columns.clone(),
            rows: Arc::clone(&dataset.rows),
            order: Arc::clone(&dataset.order),
            column_types: dataset.column_types.clone(),
            separator: dataset.separator,
        })
    };
    let left = source(&left_id)?;
    let right = source(&right_id)?;
    let joined = tauri::async_runtime::spawn_blocking(move || {
        join_datasets(left, right, &columns, join_type)
    })
    .await
    .map_err(|error| error.to_string())??;
    insert_dataset(joined, &state)
}

fn operation_source(state: &State<'_, AppState>, id: &str) -> Result<JoinSource, String> {
    let handle = dataset(state, id)?;
    let dataset = lock_dataset(&handle)?;
    Ok(JoinSource {
        columns: dataset.columns.clone(),
        rows: Arc::clone(&dataset.rows),
        order: Arc::clone(&dataset.order),
        column_types: dataset.column_types.clone(),
        separator: dataset.separator,
    })
}

#[tauri::command]
async fn create_appended_dataset(
    dataset_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    let sources = dataset_ids
        .iter()
        .map(|id| operation_source(&state, id))
        .collect::<Result<Vec<_>, _>>()?;
    let appended = tauri::async_runtime::spawn_blocking(move || append_datasets(sources))
        .await
        .map_err(|error| error.to_string())??;
    insert_dataset(appended, &state)
}

#[tauri::command]
async fn create_aggregated_dataset(
    dataset_id: String,
    aggregations: Vec<AggregationSpec>,
    group_by: Vec<String>,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    let source = operation_source(&state, &dataset_id)?;
    let aggregated = tauri::async_runtime::spawn_blocking(move || {
        aggregate_dataset(source, &aggregations, &group_by)
    })
    .await
    .map_err(|error| error.to_string())??;
    insert_dataset(aggregated, &state)
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
    let mut closed_ids = vec![dataset_id];
    let mut index = 0;
    while index < closed_ids.len() {
        for (id, handle) in &candidates {
            if lock_dataset(handle)?.source_id.as_deref() == Some(&closed_ids[index])
                && !closed_ids.contains(id)
            {
                closed_ids.push(id.clone());
            }
        }
        index += 1;
    }
    let mut store = datasets(&state)?;
    for id in closed_ids {
        store.remove(&id);
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
) -> Result<bool, String> {
    let handle = dataset(&state, &dataset_id)?;
    let (generation, rows, view, columns) = {
        let mut dataset = lock_dataset(&handle)?;
        dataset.sort_generation = dataset.sort_generation.wrapping_add(GENERATION_STEP);
        (
            dataset.sort_generation,
            Arc::clone(&dataset.rows),
            Arc::clone(&dataset.view),
            sort_columns(&dataset, &sorting),
        )
    };
    let order = sort_rows_blocking(rows, view, columns).await?;
    let mut dataset = lock_dataset(&handle)?;
    Ok(commit_sort(&mut dataset, generation, sorting, order))
}

#[tauri::command]
async fn invalidate_search(dataset_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let handle = dataset(&state, &dataset_id)?;
    let mut dataset = lock_dataset(&handle)?;
    dataset.search_generation = dataset.search_generation.wrapping_add(GENERATION_STEP);
    dataset.search = None;
    dataset.search_matches.clear();
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
    let matcher = build_matcher(&spec)?;
    let handle = dataset(&state, &dataset_id)?;
    let (generation, rows, order, column_indices) = {
        let mut dataset = lock_dataset(&handle)?;
        dataset.search_generation = dataset.search_generation.wrapping_add(GENERATION_STEP);
        dataset.search = Some(spec.clone());
        dataset.search_matches.clear();
        (
            dataset.search_generation,
            Arc::clone(&dataset.rows),
            Arc::clone(&dataset.order),
            matching_column_indices(&dataset, &spec),
        )
    };
    let matches = if let Some(matcher) = matcher {
        let rows = Arc::clone(&rows);
        let order = Arc::clone(&order);
        tauri::async_runtime::spawn_blocking(move || {
            collect_search_matches(&rows, &order, &matcher, &column_indices)
        })
        .await
        .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };
    let mut dataset = lock_dataset(&handle)?;
    commit_search(&mut dataset, generation, &order, matches);
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
    let (rows, view, column_index) = {
        let dataset = lock_dataset(&handle)?;
        let column_index = dataset
            .columns
            .iter()
            .position(|name| name == &column)
            .ok_or("Column not found")?;
        (
            Arc::clone(&dataset.rows),
            Arc::clone(&dataset.view),
            column_index,
        )
    };
    let values = view
        .iter()
        .map(|row_index| rows.cell(*row_index as usize, column_index))
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
    y_columns: Vec<String>,
    group_column: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChartData, String> {
    let handle = dataset(&state, &dataset_id)?;
    let (rows, order, x_index, y_indices, group_index) = {
        let dataset = lock_dataset(&handle)?;
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
        (
            Arc::clone(&dataset.rows),
            Arc::clone(&dataset.order),
            column_index(&x_column)?,
            y_columns
                .iter()
                .map(|column| column_index(column))
                .collect::<Result<Vec<_>, _>>()?,
            group_column.as_deref().map(column_index).transpose()?,
        )
    };
    let column_values = |index: usize| {
        order
            .iter()
            .map(|row| rows.cell(*row as usize, index).to_owned())
            .collect()
    };
    Ok(ChartData {
        x_values: column_values(x_index),
        y_values: y_indices.into_iter().map(column_values).collect(),
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
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("CSV", &["csv"])
            .set_file_name(default_name)
            .blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(file) = file else {
        return Ok(false);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    let path = path.to_string_lossy().into_owned();
    validate_csv_path(&path)?;
    let handle = dataset(&state, &dataset_id)?;
    let (rows, order, separator, column_indices) = {
        let dataset = lock_dataset(&handle)?;
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
        (
            Arc::clone(&dataset.rows),
            Arc::clone(&dataset.order),
            dataset.separator,
            column_indices,
        )
    };
    let mut writer = csv::WriterBuilder::new()
        .delimiter(separator)
        .from_path(path)
        .map_err(|error| error.to_string())?;
    writer
        .write_record(&columns)
        .map_err(|error| error.to_string())?;
    for row_index in order.iter() {
        writer
            .write_record(
                column_indices
                    .iter()
                    .map(|column_index| rows.cell(*row_index as usize, *column_index)),
            )
            .map_err(|error| error.to_string())?;
    }
    writer.flush().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn list_csv_files(
    app: AppHandle,
    on_files: Channel<Vec<FileCandidate>>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Home directory not found")?;
    app.state::<AppState>()
        .indexed_paths
        .lock()
        .map_err(|error| error.to_string())?
        .clear();

    tauri::async_runtime::spawn_blocking(move || {
        discover_csv_files(&home, MAX_INDEXED_FILES, |paths| {
            let state = app.state::<AppState>();
            let mut indexed_paths = state
                .indexed_paths
                .lock()
                .map_err(|error| error.to_string())?;
            let candidates = paths
                .into_iter()
                .map(|path| {
                    let token = state
                        .next_path_token
                        .fetch_add(1, AtomicOrdering::Relaxed)
                        .to_string();
                    let display_path = shorten_home_path(&path, &home);
                    indexed_paths.insert(token.clone(), path.clone());
                    FileCandidate {
                        token,
                        path: display_path,
                    }
                })
                .collect();
            drop(indexed_paths);
            on_files.send(candidates).map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn shorten_home_path(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(relative) if relative.as_os_str().is_empty() => "~".to_string(),
        Ok(relative) => format!("~/{}", relative.to_string_lossy()),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

fn discover_csv_files(
    home: &Path,
    max_files: usize,
    mut emit: impl FnMut(Vec<PathBuf>) -> Result<(), String>,
) -> Result<(), String> {
    let mut directories = VecDeque::from([home.to_path_buf()]);
    let mut discovered = 0;
    let mut batch = Vec::with_capacity(FILE_DISCOVERY_BATCH_SIZE);

    while !directories.is_empty() && discovered < max_files {
        let directories_at_depth = directories.len();
        for _ in 0..directories_at_depth {
            let directory = directories
                .pop_front()
                .expect("directory frontier is not empty");
            let Ok(entries) = std::fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.filter_map(Result::ok) {
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if name.starts_with('.') || is_excluded_search_directory(name) {
                    continue;
                }
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    directories.push_back(entry.path());
                } else if file_type.is_file() && is_csv_path(&entry.path()) {
                    batch.push(entry.path());
                    discovered += 1;
                    if batch.len() == FILE_DISCOVERY_BATCH_SIZE {
                        emit(std::mem::take(&mut batch))?;
                    }
                    if discovered == max_files {
                        break;
                    }
                }
            }
            if discovered == max_files {
                break;
            }
        }
        if !batch.is_empty() {
            emit(std::mem::take(&mut batch))?;
        }
    }
    Ok(())
}

fn is_excluded_search_directory(name: &str) -> bool {
    if EXCLUDED_SEARCH_DIRECTORIES.contains(&name) {
        return true;
    }
    #[cfg(target_os = "macos")]
    if MACOS_PROTECTED_DIRECTORIES.contains(&name) {
        return true;
    }
    false
}

fn is_csv_path(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
}

#[tauri::command]
fn take_opened_csv_files(state: State<'_, AppState>) -> Result<Vec<FileCandidate>, String> {
    let mut pending = state
        .pending_open_files
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn fuzzy_filter(query: String, candidates: Vec<String>) -> Result<Vec<FuzzyMatch>, String> {
    let terms: Vec<_> = query.split_whitespace().map(regex::escape).collect();
    if terms.is_empty() {
        return Ok(candidates
            .into_iter()
            .map(|text| FuzzyMatch {
                text,
                indices: Vec::new(),
            })
            .collect());
    }
    let path_pattern = RegexBuilder::new(&terms.join(".*"))
        .case_insensitive(!query.chars().any(char::is_uppercase))
        .build()
        .map_err(|error| error.to_string())?;
    let candidates = candidates
        .into_iter()
        .filter(|candidate| path_pattern.is_match(candidate));
    let mut matcher = FuzzyMatcher::new(FuzzyConfig::DEFAULT.match_paths());
    let pattern = Pattern::new(
        &query,
        CaseMatching::Smart,
        Normalization::Smart,
        AtomKind::Fuzzy,
    );
    Ok(pattern
        .match_list(candidates, &mut matcher)
        .into_iter()
        .map(|(text, _score)| {
            let mut indices = Vec::new();
            pattern.indices(
                Utf32Str::new(&text, &mut Vec::new()),
                &mut matcher,
                &mut indices,
            );
            indices.sort_unstable();
            indices.dedup();
            FuzzyMatch { text, indices }
        })
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
            create_joined_dataset,
            create_appended_dataset,
            create_aggregated_dataset,
            close_dataset,
            get_rows,
            sort_dataset,
            invalidate_search,
            search_dataset,
            get_search_match,
            get_column_stats,
            get_chart_data,
            save_csv_file_dialog,
            list_csv_files,
            take_opened_csv_files,
            fuzzy_filter
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::{Emitter, Manager};

                match queue_opened_csv_files(&urls, &app.state::<AppState>()) {
                    Ok(0) => {}
                    Ok(_) => {
                        if let Err(error) = app.emit("open-csv-files", ()) {
                            eprintln!("failed to emit open-csv-files event: {error}");
                        }
                    }
                    Err(error) => eprintln!("failed to queue opened CSV files: {error}"),
                }
            }
        });
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

    fn join_source(columns: &[&str], records: &[&[&str]]) -> JoinSource {
        let rows = Arc::new(packed_rows(records));
        JoinSource {
            columns: columns.iter().map(|column| (*column).to_owned()).collect(),
            order: Arc::new(
                (0..rows.len())
                    .map(|index| RowIndex::try_from(index).expect("test rows fit in u32"))
                    .collect(),
            ),
            column_types: vec!["string".into(); columns.len()],
            rows,
            separator: b',',
        }
    }

    fn owned_rows(dataset: &Dataset) -> Vec<Vec<String>> {
        dataset
            .order
            .iter()
            .map(|row| dataset.rows.row_owned(*row as usize))
            .collect()
    }

    #[test]
    fn performs_sql_style_inner_left_and_right_joins() {
        let make_left = || {
            join_source(
                &["id", "left_value", "shared"],
                &[
                    &["1", "A", "left-1"],
                    &["2", "B", "left-2"],
                    &["", "N", "left-null"],
                ],
            )
        };
        let make_right = || {
            join_source(
                &["id", "right_value", "shared"],
                &[
                    &["1", "X", "right-1"],
                    &["1", "Y", "right-2"],
                    &["3", "Z", "right-3"],
                    &["", "N", "right-null"],
                ],
            )
        };
        let keys = vec!["id".to_owned()];

        let inner =
            join_datasets(make_left(), make_right(), &keys, JoinType::Inner).expect("inner join");
        assert_eq!(
            inner.columns,
            [
                "id",
                "left_value",
                "shared",
                "right_value",
                "shared (right)"
            ]
        );
        assert_eq!(
            owned_rows(&inner),
            [
                ["1", "A", "left-1", "X", "right-1"],
                ["1", "A", "left-1", "Y", "right-2"],
            ]
        );

        let left =
            join_datasets(make_left(), make_right(), &keys, JoinType::Left).expect("left join");
        assert_eq!(owned_rows(&left).len(), 4);
        assert_eq!(
            owned_rows(&left)[2..],
            [["2", "B", "left-2", "", ""], ["", "N", "left-null", "", ""],]
        );

        let right =
            join_datasets(make_left(), make_right(), &keys, JoinType::Right).expect("right join");
        assert_eq!(owned_rows(&right).len(), 4);
        assert_eq!(
            owned_rows(&right)[2..],
            [
                ["3", "", "", "Z", "right-3"],
                ["", "", "", "N", "right-null"],
            ]
        );
    }

    #[test]
    fn appends_compatible_datasets_in_selection_order() {
        let appended = append_datasets(vec![
            join_source(&["id", "name"], &[&["1", "Ada"]]),
            join_source(&["id", "name"], &[&["2", "Bob"], &["3", "Cam"]]),
        ])
        .expect("append datasets");

        assert_eq!(appended.columns, ["id", "name"]);
        assert_eq!(
            owned_rows(&appended),
            [["1", "Ada"], ["2", "Bob"], ["3", "Cam"]]
        );
        assert!(append_datasets(vec![
            join_source(&["id", "name"], &[&["1", "Ada"]]),
            join_source(&["name", "id"], &[&["Bob", "2"]]),
        ])
        .is_err());
    }

    #[test]
    fn aggregates_numeric_columns_by_multiple_group_columns() {
        let mut source = join_source(
            &["region", "team", "score"],
            &[
                &["North", "A", "10"],
                &["North", "A", "20"],
                &["North", "B", "5"],
            ],
        );
        source.column_types[2] = "number".into();
        let aggregations = vec![
            AggregationSpec {
                column: "score".into(),
                function: "mean".into(),
            },
            AggregationSpec {
                column: "score".into(),
                function: "count_distinct".into(),
            },
        ];

        let aggregated =
            aggregate_dataset(source, &aggregations, &["region".into(), "team".into()])
                .expect("aggregate dataset");

        assert_eq!(
            aggregated.columns,
            ["region", "team", "mean of score", "count distinct of score"]
        );
        assert_eq!(
            owned_rows(&aggregated),
            [["North", "A", "15", "2"], ["North", "B", "5", "1"]]
        );
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
    fn parses_dates_and_iso_datetimes_strictly() {
        assert!(parse_date("2026-09-17").is_some());
        assert!(parse_date("2026-09-17T10:30:00").is_some());
        assert!(parse_date("2026-09-17 10:30:00.123").is_some());
        assert!(parse_date("2026-09-17T10:30:00Z").is_some());
        assert!(parse_date("2026-09-17T10:30:00+02:00").is_some());
        assert!(parse_date("2026-09-17 garbage").is_none());
        assert!(parse_date("2026-09-17T25:30:00").is_none());

        let rows = packed_rows(&[&["2026-09-17T10:30:00"], &["2026-09-18T11:45:00Z"]]);
        assert_eq!(infer_column_types(&rows, 1), ["date"]);
    }

    #[test]
    fn discovers_csv_files_breadth_first_with_exclusions() {
        let root = std::env::temp_dir().join(format!(
            "coccinella-discovery-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("files")
        ));
        let nested = root.join("nested");
        let deeper = nested.join("deeper");
        let excluded = root.join("Library");
        let hidden = root.join(".hidden");
        std::fs::create_dir_all(&deeper).expect("create nested fixture directory");
        std::fs::create_dir_all(&excluded).expect("create excluded fixture directory");
        std::fs::create_dir_all(&hidden).expect("create hidden fixture directory");
        std::fs::write(root.join("root.csv"), "id\n1\n").expect("write root fixture");
        std::fs::write(nested.join("nested.CSV"), "id\n2\n").expect("write nested fixture");
        std::fs::write(deeper.join("deep.csv"), "id\n3\n").expect("write deep fixture");
        std::fs::write(root.join("notes.txt"), "ignored").expect("write text fixture");
        std::fs::write(excluded.join("excluded.csv"), "id\n4\n").expect("write excluded fixture");
        std::fs::write(hidden.join("hidden.csv"), "id\n5\n").expect("write hidden fixture");

        let mut batches = Vec::new();
        discover_csv_files(&root, MAX_INDEXED_FILES, |paths| {
            batches.push(paths);
            Ok(())
        })
        .expect("discover fixture files");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");
        let names: Vec<_> = batches
            .into_iter()
            .flatten()
            .filter_map(|path| path.file_name()?.to_str().map(str::to_owned))
            .collect();

        assert_eq!(names, ["root.csv", "nested.CSV", "deep.csv"]);
    }

    #[test]
    fn batches_discovered_files_and_stops_at_the_limit() {
        let root = std::env::temp_dir().join(format!(
            "coccinella-discovery-limit-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("files")
        ));
        std::fs::create_dir_all(&root).expect("create fixture directory");
        for index in 0..FILE_DISCOVERY_BATCH_SIZE + 5 {
            std::fs::write(root.join(format!("{index}.csv")), "id\n1\n").expect("write fixture");
        }

        let mut batch_lengths = Vec::new();
        discover_csv_files(&root, FILE_DISCOVERY_BATCH_SIZE + 2, |paths| {
            batch_lengths.push(paths.len());
            Ok(())
        })
        .expect("discover fixture files");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");

        assert_eq!(MAX_INDEXED_FILES, 1_000);
        assert_eq!(batch_lengths, [FILE_DISCOVERY_BATCH_SIZE, 2]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn excludes_macos_protected_directories() {
        for directory in ["Desktop", "Documents", "Downloads"] {
            assert!(!is_excluded_search_directory(directory));
        }
        for directory in MACOS_PROTECTED_DIRECTORIES {
            assert!(is_excluded_search_directory(directory));
        }
    }

    #[test]
    fn matches_contiguous_query_terms_in_path() {
        let matches = fuzzy_filter(
            "diamonds".into(),
            vec![
                "/tmp/diamonds.csv".into(),
                "/tmp/raw_diamonds_2024.csv".into(),
                "/tmp/d-i-a-m-o-n-d-s.csv".into(),
                "/tmp/directory/with/matching/letters.csv".into(),
                "/tmp/diamonds/archive.csv".into(),
            ],
        )
        .expect("fuzzy filter candidates");
        let matches: Vec<_> = matches.into_iter().map(|m| m.text).collect();

        assert_eq!(matches.len(), 3);
        assert!(matches.contains(&"/tmp/diamonds.csv".to_owned()));
        assert!(matches.contains(&"/tmp/raw_diamonds_2024.csv".to_owned()));
        assert!(matches.contains(&"/tmp/diamonds/archive.csv".to_owned()));
    }

    #[test]
    fn matches_query_terms_found_only_in_directory_name() {
        let matches = fuzzy_filter(
            "dot".into(),
            vec![
                "/Users/tester/dotfiles/mpgcars.csv".into(),
                "/Users/tester/reports/mpgcars.csv".into(),
            ],
        )
        .expect("fuzzy filter candidates");
        let matches: Vec<_> = matches.into_iter().map(|m| m.text).collect();

        assert_eq!(matches, vec!["/Users/tester/dotfiles/mpgcars.csv"]);
    }

    #[test]
    fn spaces_allow_ordered_gaps_between_query_terms() {
        let matches = fuzzy_filter(
            "d i a".into(),
            vec![
                "/tmp/diamonds.csv".into(),
                "/tmp/d---i---a.csv".into(),
                "/tmp/a---i---d.csv".into(),
                "/tmp/d---a---i.csv".into(),
            ],
        )
        .expect("filter candidates with ordered gaps");
        let matches: Vec<_> = matches.into_iter().map(|m| m.text).collect();

        assert_eq!(matches.len(), 2);
        assert!(matches.contains(&"/tmp/diamonds.csv".to_owned()));
        assert!(matches.contains(&"/tmp/d---i---a.csv".to_owned()));
    }

    #[test]
    fn fuzzy_filter_reports_match_indices() {
        let matches = fuzzy_filter("dia".into(), vec!["/tmp/diamonds.csv".into()])
            .expect("fuzzy filter candidates");

        assert_eq!(matches.len(), 1);
        assert!(!matches[0].indices.is_empty());
    }

    #[test]
    fn shortens_paths_under_home_directory() {
        let home = Path::new("/Users/tester");
        assert_eq!(
            shorten_home_path(Path::new("/Users/tester/docs/data.csv"), home),
            "~/docs/data.csv"
        );
        assert_eq!(shorten_home_path(Path::new("/Users/tester"), home), "~");
        assert_eq!(
            shorten_home_path(Path::new("/var/data.csv"), home),
            "/var/data.csv"
        );
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
    fn sorts_precomputed_typed_keys_with_deterministic_ties() {
        let rows = packed_rows(&[
            &["2026-09-18T10:00:00Z", "bob"],
            &["2026-09-18", "Ada"],
            &["2026-09-17 12:00:00", "zoe"],
        ]);
        let view = [0, 1, 2];
        let columns = [
            (
                0,
                SortSpec {
                    id: "date".into(),
                    desc: false,
                    column_type: "date".into(),
                },
            ),
            (
                1,
                SortSpec {
                    id: "name".into(),
                    desc: false,
                    column_type: "string".into(),
                },
            ),
        ];

        assert_eq!(sort_rows(&rows, &view, &columns), [2, 1, 0]);
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
            view: Arc::new(vec![0, 1, 2]),
            order: Arc::new(vec![0, 1, 2]),
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
            sort_generation: 0,
            search_generation: 0,
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

        let columns = sort_columns(&dataset, &dataset.sorting);
        dataset.order = Arc::new(sort_rows(&dataset.rows, &dataset.view, &columns));
        let search = dataset.search.as_ref().expect("search specification");
        let matcher = build_matcher(search)
            .expect("build matcher")
            .expect("non-empty matcher");
        let column_indices = matching_column_indices(&dataset, search);
        dataset.search_matches =
            collect_search_matches(&dataset.rows, &dataset.order, &matcher, &column_indices);
        assert_eq!(dataset.order.as_slice(), [1, 2, 0]);
        assert_eq!(dataset.search_matches, [(2, 0)]);

        dataset.search = Some(FilterSpec {
            pattern: String::new(),
            is_regex: true,
            is_case_sensitive: false,
            columns: Vec::new(),
        });
        assert!(
            build_matcher(dataset.search.as_ref().expect("search specification"))
                .expect("build matcher")
                .is_none()
        );
        dataset.search_matches.clear();
        assert!(dataset.search_matches.is_empty());

        let current_order = Arc::clone(&dataset.order);
        dataset.sort_generation = 2;
        assert!(!commit_sort(&mut dataset, 1, Vec::new(), vec![0]));
        assert!(Arc::ptr_eq(&dataset.order, &current_order));

        dataset.search_generation = 2;
        assert!(!commit_search(
            &mut dataset,
            1,
            &current_order,
            vec![(0, 0)],
        ));
        assert!(dataset.search_matches.is_empty());

        dataset.search_generation = 3;
        dataset.order = Arc::new(current_order.as_ref().clone());
        assert!(!commit_search(
            &mut dataset,
            3,
            &current_order,
            vec![(0, 0)],
        ));
        assert!(dataset.search_matches.is_empty());
    }
}
