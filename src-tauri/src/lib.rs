// Owns file data and exposes operations to the Tauri frontend.
// FEATURE: Data workspace
use chrono::{DateTime, NaiveDate, NaiveDateTime};
use evalexpr::{
    build_operator_tree, ContextWithMutableVariables, DefaultNumericTypes, HashMapContext, Node,
    Operator, Value,
};
use nucleo_matcher::{
    pattern::{AtomKind, CaseMatching, Normalization, Pattern},
    Config as FuzzyConfig, Matcher as FuzzyMatcher, Utf32Str,
};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_CSV_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_JSON_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 1_000_000;
const MAX_CSV_FIELDS: usize = 10_000_000;
const MAX_CSV_COLUMNS: usize = 10_000;
const TYPE_INFERENCE_ROWS: usize = 10_000;
const MAX_CHART_POINTS: usize = 100_000;
const MAX_INDEXED_FILES: usize = 1_000;
const FILE_DISCOVERY_BATCH_SIZE: usize = 50;
const LOAD_PROGRESS_INTERVAL_BYTES: u64 = 1024 * 1024;
const ESTIMATED_MEMORY_MULTIPLIER: u64 = 2;
const FILE_LOADING_CANCELLED: &str = "File loading cancelled";
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
const MAX_DISPLAYED_DISTINCT_VALUES: usize = 1_000;
const VARIANCE_POWER: i32 = 2;
const GENERATION_STEP: u64 = 1;
const COLUMN_PLACEHOLDER: char = '$';
const COLUMN_VARIABLE_PREFIX: &str = "column_";

type DatasetHandle = Arc<Mutex<Dataset>>;
type DatasetStore = HashMap<String, DatasetHandle>;
type RowIndex = u32;
type ColumnIndex = u32;

#[derive(Clone)]
struct PackedRows {
    prefix: Option<Arc<PackedRows>>,
    data: String,
    cell_offsets: Vec<u32>,
    row_offsets: Vec<u32>,
    column_count: usize,
}

impl PackedRows {
    fn with_capacity(column_count: usize, data_capacity: usize) -> Self {
        Self {
            prefix: None,
            data: String::with_capacity(data_capacity),
            cell_offsets: vec![0],
            row_offsets: vec![0],
            column_count,
        }
    }

    fn prefix_column_count(&self) -> usize {
        self.prefix.as_ref().map_or(0, |prefix| prefix.column_count)
    }

    fn push_record(&mut self, record: &csv::StringRecord) -> Result<(), String> {
        self.push_fields(record)
    }

    fn push_fields<'a>(&mut self, fields: impl IntoIterator<Item = &'a str>) -> Result<(), String> {
        let data_len = self.data.len();
        let cell_count = self.cell_offsets.len();
        for field in fields {
            self.data.push_str(field);
            self.cell_offsets.push(self.current_offset()?);
        }
        let field_count = self.cell_offsets.len() - cell_count;
        if field_count != self.column_count {
            self.data.truncate(data_len);
            self.cell_offsets.truncate(cell_count);
            return Err(format!(
                "CSV row has {field_count} fields; expected {}",
                self.column_count
            ));
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
        let prefix_column_count = self.prefix_column_count();
        if let Some(prefix) = self.prefix.as_ref().filter(|_| column_index < prefix_column_count) {
            return prefix.cell(row_index, column_index);
        }
        let cell_index = row_index * self.column_count + column_index - prefix_column_count;
        let start = self.cell_offsets[cell_index] as usize;
        let end = self.cell_offsets[cell_index + 1] as usize;
        &self.data[start..end]
    }

    fn row_owned(&self, row_index: usize) -> Vec<String> {
        (0..self.prefix_column_count() + self.column_count)
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
    file_scan_tokens: Mutex<HashSet<String>>,
    previous_file_scan_tokens: Mutex<HashSet<String>>,
    pending_open_files: Mutex<Vec<FileCandidate>>,
    active_loads: Mutex<HashMap<String, Arc<AtomicBool>>>,
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
    filter: Option<Filter>,
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

#[derive(Clone)]
enum Filter {
    Pattern(FilterSpec),
    Expression {
        column: String,
        condition: ExpressionCondition,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum DateDirection {
    Before,
    After,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ExpressionCondition {
    Number { expression: String },
    Date { date: String, direction: DateDirection },
    Boolean { value: bool },
    Included { values: Vec<String> },
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
#[serde(tag = "kind", rename_all = "lowercase")]
enum OpenedFile {
    Csv {
        filename: String,
        path: String,
        metadata: SheetMetadata,
    },
    Json {
        filename: String,
        path: String,
        id: String,
        data: Box<RawValue>,
        #[serde(rename = "sizeBytes")]
        size_bytes: u64,
    },
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FileKind {
    Csv,
    Json,
}

#[derive(Serialize)]
struct FileCandidate {
    token: String,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProgress {
    operation_id: String,
    filename: String,
    bytes_read: u64,
    total_bytes: u64,
    estimated_memory_bytes: u64,
}

struct LoadControl {
    operation_id: String,
    filename: String,
    cancelled: Arc<AtomicBool>,
    on_progress: Channel<LoadProgress>,
    last_reported_bytes: u64,
}

impl LoadControl {
    fn report(&mut self, bytes_read: u64, total_bytes: u64, force: bool) -> Result<(), String> {
        if self.cancelled.load(AtomicOrdering::Relaxed) {
            return Err(FILE_LOADING_CANCELLED.into());
        }
        if force
            || bytes_read.saturating_sub(self.last_reported_bytes) >= LOAD_PROGRESS_INTERVAL_BYTES
        {
            let _ = self.on_progress.send(LoadProgress {
                operation_id: self.operation_id.clone(),
                filename: self.filename.clone(),
                bytes_read,
                total_bytes,
                estimated_memory_bytes: total_bytes.saturating_mul(ESTIMATED_MEMORY_MULTIPLIER),
            });
            self.last_reported_bytes = bytes_read;
        }
        Ok(())
    }
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

#[derive(Serialize)]
struct DistinctValue {
    value: String,
    count: usize,
}

#[derive(Serialize)]
struct DistinctValues {
    total: usize,
    values: Vec<DistinctValue>,
}

enum Matcher {
    Regex(Regex),
    Plain(String),
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
            Self::Plain(pattern) => value.contains(pattern),
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

fn validate_delimited_path(path: &str) -> Result<(), String> {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv" | "tsv") => Ok(()),
        _ => Err("Only .csv and .tsv files are supported".into()),
    }
}

fn is_tsv_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("tsv"))
}

fn file_kind(path: &Path) -> Option<FileKind> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "csv" | "tsv" => Some(FileKind::Csv),
        "json" => Some(FileKind::Json),
        _ => None,
    }
}

fn validate_data_path(path: &str) -> Result<FileKind, String> {
    file_kind(Path::new(path)).ok_or_else(|| "Only .csv, .tsv and .json files are supported".into())
}

#[cfg(target_os = "macos")]
fn queue_opened_files(urls: &[tauri::Url], state: &AppState) -> Result<usize, String> {
    let paths = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| validate_data_path(&path.to_string_lossy()).is_ok())
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

fn format_binary_bytes(bytes: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = KIB * 1024;
    const GIB: u64 = MIB * 1024;
    if bytes >= GIB {
        format!("{:.1} GiB", bytes as f64 / GIB as f64)
    } else if bytes >= MIB {
        format!("{:.1} MiB", bytes as f64 / MIB as f64)
    } else if bytes >= KIB {
        format!("{:.1} KiB", bytes as f64 / KIB as f64)
    } else {
        format!("{bytes} B")
    }
}

fn read_dataset_controlled(
    path: &str,
    separator: u8,
    mut control: Option<&mut LoadControl>,
) -> Result<Dataset, String> {
    validate_delimited_path(path)?;
    let file = File::open(path).map_err(|error| error.to_string())?;
    let size_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if size_bytes > MAX_CSV_FILE_BYTES {
        return Err(format!(
            "Delimited file is too large: {} exceeds the {} limit",
            format_binary_bytes(size_bytes),
            format_binary_bytes(MAX_CSV_FILE_BYTES)
        ));
    }
    if let Some(control) = control.as_deref_mut() {
        control.report(0, size_bytes, true)?;
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
        if let Some(control) = control.as_deref_mut() {
            control.report(reader.position().byte(), size_bytes, false)?;
        }
        if rows.len() >= MAX_CSV_ROWS {
            return Err(format!("CSV exceeds the {MAX_CSV_ROWS}-row limit"));
        }
        field_count += record.len();
        if field_count > MAX_CSV_FIELDS {
            return Err(format!("CSV exceeds the {MAX_CSV_FIELDS}-field limit"));
        }
        rows.push_record(&record)?;
    }
    if let Some(control) = control.as_deref_mut() {
        control.report(size_bytes, size_bytes, true)?;
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

fn read_dataset(path: &str, separator: u8) -> Result<Dataset, String> {
    read_dataset_controlled(path, separator, None)
}

fn read_tsv_dataset_controlled(
    path: &str,
    control: Option<&mut LoadControl>,
) -> Result<Dataset, String> {
    let field_count = |separator| -> Result<usize, String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(separator)
            .from_reader(file);
        Ok(reader.headers().map_err(|error| error.to_string())?.len())
    };
    let separator = if field_count(b'\t')? > 1 || field_count(b' ')? <= 1 {
        b'\t'
    } else {
        b' '
    };
    read_dataset_controlled(path, separator, control)
}

#[cfg(test)]
fn read_tsv_dataset(path: &str) -> Result<Dataset, String> {
    read_tsv_dataset_controlled(path, None)
}

async fn read_dataset_blocking(path: String, separator: u8) -> Result<Dataset, String> {
    tauri::async_runtime::spawn_blocking(move || read_dataset(&path, separator))
        .await
        .map_err(|error| error.to_string())?
}

async fn read_opened_dataset_blocking(
    path: String,
    separator: u8,
    operation_id: String,
    on_progress: Channel<LoadProgress>,
    state: &State<'_, AppState>,
) -> Result<Dataset, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .active_loads
        .lock()
        .map_err(|error| error.to_string())?
        .insert(operation_id.clone(), Arc::clone(&cancelled));
    let cleanup_id = operation_id.clone();
    let is_tsv = is_tsv_path(&path);
    let filename = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut control = LoadControl {
            operation_id,
            filename,
            cancelled,
            on_progress,
            last_reported_bytes: 0,
        };
        if is_tsv {
            read_tsv_dataset_controlled(&path, Some(&mut control))
        } else {
            read_dataset_controlled(&path, separator, Some(&mut control))
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    state
        .active_loads
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&cleanup_id);
    result
}

fn read_json(path: &str) -> Result<(Box<RawValue>, u64), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let size_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if size_bytes > MAX_JSON_FILE_BYTES {
        return Err(format!(
            "JSON is too large: {} exceeds the {} limit",
            format_binary_bytes(size_bytes),
            format_binary_bytes(MAX_JSON_FILE_BYTES)
        ));
    }
    let mut text = String::with_capacity(size_bytes as usize);
    file.read_to_string(&mut text).map_err(|error| error.to_string())?;
    let data = RawValue::from_string(text).map_err(|error| error.to_string())?;
    Ok((data, size_bytes))
}

async fn open_file_at_path(
    path: PathBuf,
    separator: u8,
    operation_id: String,
    on_progress: Channel<LoadProgress>,
    state: &State<'_, AppState>,
) -> Result<OpenedFile, String> {
    let kind = validate_data_path(&path.to_string_lossy())?;
    let path_string = path.to_string_lossy().into_owned();
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Selected file has no valid filename")?
        .to_owned();
    match kind {
        FileKind::Csv => {
            let dataset = read_opened_dataset_blocking(
                path_string.clone(),
                separator,
                operation_id,
                on_progress,
                state,
            )
            .await?;
            let metadata = insert_dataset(dataset, state)?;
            Ok(OpenedFile::Csv {
                filename,
                path: path_string,
                metadata,
            })
        }
        FileKind::Json => {
            let read_path = path_string.clone();
            let (data, size_bytes) =
                tauri::async_runtime::spawn_blocking(move || read_json(&read_path))
                    .await
                    .map_err(|error| error.to_string())??;
            let id = state
                .next_dataset_id
                .fetch_add(1, AtomicOrdering::Relaxed)
                .to_string();
            Ok(OpenedFile::Json {
                filename,
                path: path_string,
                id,
                data,
                size_bytes,
            })
        }
    }
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
    if !spec.is_regex && spec.is_case_sensitive {
        return Ok(Some(Matcher::Plain(spec.pattern.clone())));
    }
    let pattern = if spec.is_regex {
        spec.pattern.clone()
    } else {
        regex::escape(&spec.pattern)
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!spec.is_case_sensitive)
        .build()
        .map(Matcher::Regex)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn matching_rows(dataset: &Dataset, filter: &Filter) -> Result<Vec<RowIndex>, String> {
    match filter {
        Filter::Pattern(spec) => {
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
        Filter::Expression { column, condition } => {
            let Some(column_index) = dataset
                .columns
                .iter()
                .position(|candidate| candidate == column)
            else {
                return Ok(Vec::new());
            };
            collect_expression_matches(&dataset.rows, &dataset.view, column_index, condition)
        }
    }
}

fn convert_int_constants_to_floats(node: &mut Node<DefaultNumericTypes>) {
    if let Operator::Const { value } = node.operator_mut() {
        if let Value::Int(int) = *value {
            *value = Value::from_float(int as f64);
        }
    }
    for child in node.children_mut() {
        convert_int_constants_to_floats(child);
    }
}

type CellMatcher = Box<dyn FnMut(&str) -> bool>;

fn expression_cell_matcher(condition: &ExpressionCondition) -> Result<CellMatcher, String> {
    match condition {
        ExpressionCondition::Number { expression } => {
            let mut tree = build_operator_tree::<DefaultNumericTypes>(expression)
                .map_err(|error| error.to_string())?;
            convert_int_constants_to_floats(&mut tree);
            let mut context = HashMapContext::<DefaultNumericTypes>::new();
            Ok(Box::new(move |cell| {
                let Ok(x) = cell.parse::<f64>() else {
                    return false;
                };
                if context.set_value("x".into(), Value::from_float(x)).is_err() {
                    return false;
                }
                tree.eval_boolean_with_context(&context).unwrap_or(false)
            }))
        }
        ExpressionCondition::Date { date, direction } => {
            let target = parse_date(date).ok_or("Invalid date")?;
            let direction = *direction;
            Ok(Box::new(move |cell| {
                parse_date(cell).is_some_and(|value| match direction {
                    DateDirection::Before => value < target,
                    DateDirection::After => value > target,
                })
            }))
        }
        ExpressionCondition::Boolean { value } => {
            let expected = if *value { "true" } else { "false" };
            Ok(Box::new(move |cell| cell.eq_ignore_ascii_case(expected)))
        }
        ExpressionCondition::Included { values } => {
            let included = values
                .iter()
                .map(|value| value.trim().to_owned())
                .collect::<HashSet<_>>();
            Ok(Box::new(move |cell| included.contains(cell)))
        }
    }
}

fn collect_expression_matches(
    rows: &PackedRows,
    view: &[RowIndex],
    column_index: usize,
    condition: &ExpressionCondition,
) -> Result<Vec<RowIndex>, String> {
    let mut matches_cell = expression_cell_matcher(condition)?;
    Ok(view
        .iter()
        .copied()
        .filter(|row_index| matches_cell(rows.cell(*row_index as usize, column_index).trim()))
        .collect())
}

fn has_expression_match(
    rows: &PackedRows,
    view: &[RowIndex],
    column_index: usize,
    condition: &ExpressionCondition,
) -> Result<bool, String> {
    let mut matches_cell = expression_cell_matcher(condition)?;
    Ok(view
        .iter()
        .any(|row_index| matches_cell(rows.cell(*row_index as usize, column_index).trim())))
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

fn compile_column_expression(
    expression: &str,
    columns: &[String],
    number_columns: &[String],
) -> Result<(String, Vec<usize>), String> {
    let mut candidates = number_columns
        .iter()
        .filter_map(|column| {
            columns
                .iter()
                .position(|candidate| candidate == column)
                .map(|index| (index, column))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, column)| std::cmp::Reverse(column.len()));
    let mut compiled = String::with_capacity(expression.len());
    let mut referenced = Vec::<usize>::new();
    let mut remaining = expression;
    while let Some(position) = remaining.find(COLUMN_PLACEHOLDER) {
        compiled.push_str(&remaining[..position]);
        let after = &remaining[position + COLUMN_PLACEHOLDER.len_utf8()..];
        let (column_index, column) = candidates
            .iter()
            .find(|(_, column)| after.starts_with(column.as_str()))
            .ok_or_else(|| {
                format!("Unknown number column after {COLUMN_PLACEHOLDER}{after}")
            })?;
        let variable_index = referenced
            .iter()
            .position(|index| index == column_index)
            .unwrap_or_else(|| {
                referenced.push(*column_index);
                referenced.len() - 1
            });
        compiled.push_str(&format!(" {COLUMN_VARIABLE_PREFIX}{variable_index} "));
        remaining = &after[column.len()..];
    }
    compiled.push_str(remaining);
    Ok((compiled, referenced))
}

fn add_expression_column(
    source: JoinSource,
    name: &str,
    expression: &str,
    number_columns: &[String],
) -> Result<Dataset, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a name for the new column".into());
    }
    if source.columns.iter().any(|column| column == name) {
        return Err(format!("Column already exists: {name}"));
    }
    let column_count = source.columns.len() + 1;
    if column_count > MAX_CSV_COLUMNS {
        return Err(format!("Data exceeds the {MAX_CSV_COLUMNS}-column limit"));
    }
    if column_count.saturating_mul(source.order.len() + 1) > MAX_CSV_FIELDS {
        return Err(format!("Data exceeds the {MAX_CSV_FIELDS}-field limit"));
    }
    let (compiled, referenced) =
        compile_column_expression(expression, &source.columns, number_columns)?;
    let mut tree =
        build_operator_tree::<DefaultNumericTypes>(&compiled).map_err(|error| error.to_string())?;
    convert_int_constants_to_floats(&mut tree);
    let variables = (0..referenced.len())
        .map(|index| format!("{COLUMN_VARIABLE_PREFIX}{index}"))
        .collect::<Vec<_>>();
    let (prefix, carried_columns, carried_bytes) = match &source.rows.prefix {
        Some(prefix) => (
            Arc::clone(prefix),
            prefix.column_count..source.columns.len(),
            source.rows.data.len(),
        ),
        None => (
            Arc::clone(&source.rows),
            source.columns.len()..source.columns.len(),
            0,
        ),
    };
    let mut in_view = vec![false; source.rows.len()];
    for row_index in source.order.iter() {
        in_view[*row_index as usize] = true;
    }
    let mut context = HashMapContext::<DefaultNumericTypes>::new();
    let mut rows = PackedRows::with_capacity(carried_columns.len() + 1, carried_bytes);
    let mut result_type = None;
    for (row, is_in_view) in in_view.into_iter().enumerate() {
        let mut inputs_are_numbers = is_in_view;
        if is_in_view {
            for (variable, column_index) in variables.iter().zip(&referenced) {
                let Ok(value) = source.rows.cell(row, *column_index).trim().parse::<f64>() else {
                    inputs_are_numbers = false;
                    break;
                };
                context
                    .set_value(variable.clone(), Value::from_float(value))
                    .map_err(|error| error.to_string())?;
            }
        }
        let value = if inputs_are_numbers {
            let (value, value_type) = match tree
                .eval_with_context(&context)
                .map_err(|error| error.to_string())?
            {
                Value::Float(result) if result.is_finite() => (result.to_string(), "number"),
                Value::Float(_) => (String::new(), "number"),
                Value::Int(result) => (result.to_string(), "number"),
                Value::Boolean(result) => (result.to_string(), "boolean"),
                other => {
                    return Err(format!(
                        "Expression must return a number or a boolean, but got {other}"
                    ))
                }
            };
            if *result_type.get_or_insert(value_type) != value_type {
                return Err("Expression must return the same type for every row".into());
            }
            value
        } else {
            String::new()
        };
        rows.push_fields(
            carried_columns
                .clone()
                .map(|column_index| source.rows.cell(row, column_index))
                .chain(std::iter::once(value.as_str())),
        )?;
    }
    rows.shrink_to_fit();
    rows.prefix = Some(prefix);
    let mut columns = source.columns.clone();
    columns.push(name.to_owned());
    let mut column_types = source.column_types.clone();
    column_types.push(result_type.unwrap_or("number").to_owned());
    Ok(Dataset {
        columns,
        rows: Arc::new(rows),
        view: Arc::clone(&source.order),
        order: source.order,
        column_types,
        separator: source.separator,
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
    pivot_table: bool,
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
    if pivot_table {
        if group_indices.len() != 2 {
            return Err(
                "Pivot tables need exactly two group-by columns: one for rows and one for columns"
                    .into(),
            );
        }
        if aggregations.len() != 1 {
            return Err("Pivot tables support exactly one aggregated measure".into());
        }
        return pivot_aggregate_dataset(&source, &aggregations[0], aggregation_indices[0], &group_indices);
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

fn pivot_aggregate_dataset(
    source: &JoinSource,
    aggregation: &AggregationSpec,
    aggregation_index: usize,
    group_indices: &[usize],
) -> Result<Dataset, String> {
    let row_index = group_indices[0];
    let col_index = group_indices[1];

    let mut cells = HashMap::<(String, String), Vec<RowIndex>>::new();
    let mut row_keys = Vec::<String>::new();
    let mut row_seen = HashSet::<String>::new();
    let mut col_keys = Vec::<String>::new();
    let mut col_seen = HashSet::<String>::new();

    for row in source.order.iter().copied() {
        let row_key = source.rows.cell(row as usize, row_index).to_owned();
        let col_key = source.rows.cell(row as usize, col_index).to_owned();
        if row_seen.insert(row_key.clone()) {
            row_keys.push(row_key.clone());
        }
        if col_seen.insert(col_key.clone()) {
            col_keys.push(col_key.clone());
        }
        cells.entry((row_key, col_key)).or_default().push(row);
    }

    sort_pivot_keys(&mut row_keys, &source.column_types[row_index]);
    sort_pivot_keys(&mut col_keys, &source.column_types[col_index]);

    let mut output_columns = Vec::with_capacity(col_keys.len() + 1);
    output_columns.push(source.columns[row_index].clone());
    output_columns.extend(col_keys.iter().cloned());

    let mut rows = PackedRows::with_capacity(output_columns.len(), 0);
    for row_key in &row_keys {
        let mut fields = Vec::with_capacity(output_columns.len());
        fields.push(row_key.clone());
        for col_key in &col_keys {
            let value = match cells.get(&(row_key.clone(), col_key.clone())) {
                Some(group_rows) => {
                    aggregate_value(source, group_rows, aggregation_index, &aggregation.function)?
                }
                None => String::new(),
            };
            fields.push(value);
        }
        rows.push_record(&csv::StringRecord::from(fields))?;
    }

    let mut column_types = Vec::with_capacity(output_columns.len());
    column_types.push(source.column_types[row_index].clone());
    let value_type = match aggregation.function.as_str() {
        "mode" | "min" | "max" => source.column_types[aggregation_index].clone(),
        _ => "number".to_owned(),
    };
    column_types.extend(col_keys.iter().map(|_| value_type.clone()));

    Ok(derived_dataset(
        output_columns,
        rows,
        column_types,
        source.separator,
    ))
}

fn sort_pivot_keys(keys: &mut [String], column_type: &str) {
    keys.sort_by(|a, b| match (a.is_empty(), b.is_empty()) {
        (true, true) => Ordering::Equal,
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        (false, false) => match column_type {
            "number" => a
                .parse::<f64>()
                .ok()
                .zip(b.parse::<f64>().ok())
                .map(|(a, b)| a.partial_cmp(&b).unwrap_or(Ordering::Equal))
                .unwrap_or_else(|| a.cmp(b)),
            "date" => parse_date(a)
                .zip(parse_date(b))
                .map(|(a, b)| a.cmp(&b))
                .unwrap_or_else(|| a.cmp(b)),
            _ => a.cmp(b),
        },
    });
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
        .or_else(|| NaiveDate::parse_from_str(value, "%d/%m/%Y").ok())
        .or_else(|| {
            let timestamp = value.parse::<i64>().ok()?;
            let date_time = if value.trim_start_matches('-').len() > 10 {
                DateTime::from_timestamp_millis(timestamp)
            } else {
                DateTime::from_timestamp(timestamp, 0)
            }?;
            Some(date_time.date_naive())
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
async fn open_file_dialog(
    separator: String,
    operation_id: String,
    on_progress: Channel<LoadProgress>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedFile>, String> {
    let separator = separator_byte(&separator)?;
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Data", &["csv", "tsv", "json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(file) = file else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    Ok(Some(
        open_file_at_path(path, separator, operation_id, on_progress, &state).await?,
    ))
}

#[tauri::command]
async fn load_indexed_file(
    token: String,
    separator: String,
    operation_id: String,
    on_progress: Channel<LoadProgress>,
    state: State<'_, AppState>,
) -> Result<OpenedFile, String> {
    let path = state
        .indexed_paths
        .lock()
        .map_err(|error| error.to_string())?
        .get(&token)
        .cloned()
        .ok_or("File selection expired")?;
    let separator = separator_byte(&separator)?;
    open_file_at_path(path, separator, operation_id, on_progress, &state).await
}

#[tauri::command]
fn cancel_file_load(operation_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(cancelled) = state
        .active_loads
        .lock()
        .map_err(|error| error.to_string())?
        .get(&operation_id)
    {
        cancelled.store(true, AtomicOrdering::Relaxed);
    }
    Ok(())
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
    let filters = children
        .iter()
        .map(|(_, _, filter, _)| filter.clone().ok_or("Filtered dataset is missing its filter"))
        .collect::<Result<Vec<_>, _>>()?;
    let (root, views) = tauri::async_runtime::spawn_blocking(move || {
        let views = filters
            .iter()
            .map(|filter| matching_rows(&root, filter))
            .collect::<Result<Vec<_>, String>>();
        (root, views)
    })
    .await
    .map_err(|error| error.to_string())?;
    for ((child_id, handle, filter, sorting), view) in children.into_iter().zip(views?) {
        let filter = filter.ok_or("Filtered dataset is missing its filter")?;
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
        filter: Some(Filter::Pattern(filter)),
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
async fn expression_condition_matches(
    source_id: String,
    column: String,
    condition: ExpressionCondition,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let source_handle = dataset(&state, &source_id)?;
    let (rows, view, column_index) = {
        let source = lock_dataset(&source_handle)?;
        let Some(column_index) = source.columns.iter().position(|candidate| candidate == &column)
        else {
            return Ok(false);
        };
        (Arc::clone(&source.rows), Arc::clone(&source.view), column_index)
    };
    tauri::async_runtime::spawn_blocking(move || {
        has_expression_match(&rows, &view, column_index, &condition)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_expression_filtered_dataset(
    source_id: String,
    column: String,
    condition: ExpressionCondition,
    state: State<'_, AppState>,
) -> Result<Option<SheetMetadata>, String> {
    let source_handle = dataset(&state, &source_id)?;
    let (rows, source_view, column_index, source_columns, column_types, separator) = {
        let source = lock_dataset(&source_handle)?;
        let column_index = source
            .columns
            .iter()
            .position(|candidate| candidate == &column)
            .ok_or("Column not found")?;
        (
            Arc::clone(&source.rows),
            Arc::clone(&source.view),
            column_index,
            source.columns.clone(),
            source.column_types.clone(),
            source.separator,
        )
    };
    let rows_for_filter = Arc::clone(&rows);
    let condition_for_filter = condition.clone();
    let view = tauri::async_runtime::spawn_blocking(move || {
        collect_expression_matches(&rows_for_filter, &source_view, column_index, &condition_for_filter)
    })
    .await
    .map_err(|error| error.to_string())??;
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
        filter: Some(Filter::Expression { column, condition }),
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
    pivot_table: bool,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    let source = operation_source(&state, &dataset_id)?;
    let aggregated = tauri::async_runtime::spawn_blocking(move || {
        aggregate_dataset(source, &aggregations, &group_by, pivot_table)
    })
    .await
    .map_err(|error| error.to_string())??;
    insert_dataset(aggregated, &state)
}

#[tauri::command]
async fn create_column_dataset(
    dataset_id: String,
    name: String,
    expression: String,
    number_columns: Vec<String>,
    state: State<'_, AppState>,
) -> Result<SheetMetadata, String> {
    let source = operation_source(&state, &dataset_id)?;
    let dataset = tauri::async_runtime::spawn_blocking(move || {
        add_expression_column(source, &name, &expression, &number_columns)
    })
    .await
    .map_err(|error| error.to_string())??;
    insert_dataset(dataset, &state)
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

fn column_view(
    state: &State<'_, AppState>,
    dataset_id: &str,
    column: &str,
) -> Result<(Arc<PackedRows>, Arc<Vec<RowIndex>>, usize), String> {
    let handle = dataset(state, dataset_id)?;
    let dataset = lock_dataset(&handle)?;
    let column_index = dataset
        .columns
        .iter()
        .position(|name| name == column)
        .ok_or("Column not found")?;
    Ok((
        Arc::clone(&dataset.rows),
        Arc::clone(&dataset.view),
        column_index,
    ))
}

fn distinct_values(
    rows: &PackedRows,
    view: &[RowIndex],
    column_index: usize,
    limit: usize,
) -> DistinctValues {
    let mut frequencies = HashMap::<&str, usize>::new();
    for row_index in view {
        *frequencies
            .entry(rows.cell(*row_index as usize, column_index))
            .or_default() += 1;
    }
    let total = frequencies.len();
    let mut entries = frequencies.into_iter().collect::<Vec<_>>();
    let by_frequency = |left: &(&str, usize), right: &(&str, usize)| {
        right.1.cmp(&left.1).then_with(|| left.0.cmp(right.0))
    };
    if entries.len() > limit {
        entries.select_nth_unstable_by(limit, by_frequency);
        entries.truncate(limit);
    }
    entries.sort_by(by_frequency);
    DistinctValues {
        total,
        values: entries
            .into_iter()
            .map(|(value, count)| DistinctValue {
                value: value.to_owned(),
                count,
            })
            .collect(),
    }
}

fn longest_value(rows: &PackedRows, view: &[RowIndex], column_index: usize) -> String {
    view.iter()
        .map(|row_index| rows.cell(*row_index as usize, column_index))
        .max_by_key(|value| value.chars().count())
        .unwrap_or_default()
        .to_owned()
}

#[tauri::command]
async fn get_distinct_values(
    dataset_id: String,
    column: String,
    state: State<'_, AppState>,
) -> Result<DistinctValues, String> {
    let (rows, view, column_index) = column_view(&state, &dataset_id, &column)?;
    Ok(distinct_values(
        &rows,
        &view,
        column_index,
        MAX_DISPLAYED_DISTINCT_VALUES,
    ))
}

#[tauri::command]
async fn get_longest_value(
    dataset_id: String,
    column: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (rows, view, column_index) = column_view(&state, &dataset_id, &column)?;
    Ok(longest_value(&rows, &view, column_index))
}

#[tauri::command]
async fn get_column_stats(
    dataset_id: String,
    column: String,
    column_type: String,
    state: State<'_, AppState>,
) -> Result<Option<ColumnStats>, String> {
    let (rows, view, column_index) = column_view(&state, &dataset_id, &column)?;
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
async fn list_data_files(
    app: AppHandle,
    on_files: Channel<Vec<FileCandidate>>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Home directory not found")?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut next_scan_tokens = HashSet::new();
        let result = discover_data_files(&home, MAX_INDEXED_FILES, |paths| {
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
                    next_scan_tokens.insert(token.clone());
                    FileCandidate {
                        token,
                        path: display_path,
                    }
                })
                .collect();
            drop(indexed_paths);
            on_files.send(candidates).map_err(|error| error.to_string())
        });
        let state = app.state::<AppState>();
        let mut indexed_paths = state
            .indexed_paths
            .lock()
            .map_err(|error| error.to_string())?;
        let mut file_scan_tokens = state
            .file_scan_tokens
            .lock()
            .map_err(|error| error.to_string())?;
        let mut previous_file_scan_tokens = state
            .previous_file_scan_tokens
            .lock()
            .map_err(|error| error.to_string())?;
        if result.is_ok() {
            for token in previous_file_scan_tokens.drain() {
                indexed_paths.remove(&token);
            }
            *previous_file_scan_tokens = std::mem::take(&mut *file_scan_tokens);
            *file_scan_tokens = next_scan_tokens;
        } else {
            for token in next_scan_tokens {
                indexed_paths.remove(&token);
            }
        }
        result
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

fn discover_data_files(
    home: &Path,
    max_files: usize,
    mut emit: impl FnMut(Vec<PathBuf>) -> Result<(), String>,
) -> Result<(), String> {
    let mut directories = VecDeque::from([home.to_path_buf()]);
    let mut discovered_csv = 0;
    let mut discovered_json = 0;
    let mut batch = Vec::with_capacity(FILE_DISCOVERY_BATCH_SIZE);
    let budgets_exhausted =
        |csv: usize, json: usize| csv == max_files && json == max_files;

    while !directories.is_empty() && !budgets_exhausted(discovered_csv, discovered_json) {
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
                } else if file_type.is_file() {
                    let path = entry.path();
                    let discovered = match file_kind(&path) {
                        Some(FileKind::Csv) => &mut discovered_csv,
                        Some(FileKind::Json) => &mut discovered_json,
                        None => continue,
                    };
                    if *discovered == max_files {
                        continue;
                    }
                    *discovered += 1;
                    batch.push(path);
                    if batch.len() == FILE_DISCOVERY_BATCH_SIZE {
                        emit(std::mem::take(&mut batch))?;
                    }
                    if budgets_exhausted(discovered_csv, discovered_json) {
                        break;
                    }
                }
            }
            if budgets_exhausted(discovered_csv, discovered_json) {
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

#[tauri::command]
fn take_opened_files(state: State<'_, AppState>) -> Result<Vec<FileCandidate>, String> {
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
            open_file_dialog,
            load_indexed_file,
            cancel_file_load,
            rescan_csv_file,
            create_filtered_dataset,
            expression_condition_matches,
            create_expression_filtered_dataset,
            create_joined_dataset,
            create_appended_dataset,
            create_aggregated_dataset,
            create_column_dataset,
            close_dataset,
            get_rows,
            sort_dataset,
            invalidate_search,
            search_dataset,
            get_search_match,
            get_column_stats,
            get_distinct_values,
            get_longest_value,
            get_chart_data,
            save_csv_file_dialog,
            list_data_files,
            take_opened_files,
            fuzzy_filter
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::{Emitter, Manager};

                match queue_opened_files(&urls, &app.state::<AppState>()) {
                    Ok(0) => {}
                    Ok(_) => {
                        if let Err(error) = app.emit("open-files", ()) {
                            eprintln!("failed to emit open-files event: {error}");
                        }
                    }
                    Err(error) => eprintln!("failed to queue opened files: {error}"),
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
    fn counts_distinct_values_in_view_by_descending_frequency() {
        let rows = packed_rows(&[&["b"], &["a"], &["b"], &[""], &["c"], &["a"], &["b"]]);
        let view = vec![0, 1, 2, 3, 4, 5];

        let distinct = distinct_values(&rows, &view, 0, MAX_DISPLAYED_DISTINCT_VALUES);
        let values = distinct
            .values
            .into_iter()
            .map(|distinct| (distinct.value, distinct.count))
            .collect::<Vec<_>>();

        assert_eq!(distinct.total, 4);
        assert_eq!(
            values,
            [
                ("a".to_owned(), 2),
                ("b".to_owned(), 2),
                ("".to_owned(), 1),
                ("c".to_owned(), 1),
            ]
        );
    }

    #[test]
    fn rejects_pushed_fields_with_wrong_count_without_changing_rows() {
        let mut rows = packed_rows(&[&["a", "b"]]);

        assert!(rows.push_fields(["c"]).is_err());
        assert!(rows.push_fields(["c", "d", "e"]).is_err());
        rows.push_fields(["c", "d"]).expect("valid row");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows.row_owned(1), ["c", "d"]);
    }

    #[test]
    fn limits_distinct_values_to_most_frequent_and_reports_total() {
        let rows = packed_rows(&[&["d"], &["b"], &["a"], &["b"], &["c"], &["a"], &["b"]]);
        let view = vec![0, 1, 2, 3, 4, 5, 6];

        let distinct = distinct_values(&rows, &view, 0, 2);
        let values = distinct
            .values
            .into_iter()
            .map(|distinct| (distinct.value, distinct.count))
            .collect::<Vec<_>>();

        assert_eq!(distinct.total, 4);
        assert_eq!(values, [("b".to_owned(), 3), ("a".to_owned(), 2)]);
    }

    #[test]
    fn finds_longest_value_in_view_by_character_count() {
        let rows = packed_rows(&[&["short"], &["ééééééé"], &["longest value"]]);

        assert_eq!(longest_value(&rows, &[0, 1, 2], 0), "longest value");
        assert_eq!(longest_value(&rows, &[0, 1], 0), "ééééééé");
        assert_eq!(longest_value(&rows, &[], 0), "");
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

        let aggregated = aggregate_dataset(
            source,
            &aggregations,
            &["region".into(), "team".into()],
            false,
        )
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
    fn pivots_aggregated_values_into_a_crosstab() {
        let mut source = join_source(
            &["region", "date", "units"],
            &[
                &["East", "2005-02-28", "10"],
                &["East", "2005-01-31", "5"],
                &["West", "2005-01-31", "3"],
                &["", "2005-01-31", "1"],
            ],
        );
        source.column_types[2] = "number".into();
        let aggregations = vec![AggregationSpec {
            column: "units".into(),
            function: "sum".into(),
        }];

        let pivoted = aggregate_dataset(
            source,
            &aggregations,
            &["region".into(), "date".into()],
            true,
        )
        .expect("pivot dataset");

        assert_eq!(pivoted.columns, ["region", "2005-01-31", "2005-02-28"]);
        assert_eq!(
            owned_rows(&pivoted),
            [
                ["East", "5", "10"],
                ["West", "3", ""],
                ["", "1", ""],
            ]
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
    fn parses_tsv_with_tabs_and_falls_back_to_spaces() {
        let tab_path = std::env::temp_dir().join(format!(
            "coccinella-tab-separated-{}-{}.tsv",
            std::process::id(),
            std::thread::current().name().unwrap_or("tsv")
        ));
        let space_path = std::env::temp_dir().join(format!(
            "coccinella-space-separated-{}-{}.tsv",
            std::process::id(),
            std::thread::current().name().unwrap_or("tsv")
        ));
        std::fs::write(&tab_path, "name\tscore\nAda\t10\n").expect("write tab fixture");
        std::fs::write(&space_path, "name score\nAda 10\n").expect("write space fixture");

        let tab_dataset = read_tsv_dataset(tab_path.to_str().expect("UTF-8 path"))
            .expect("parse tab-separated TSV");
        let space_dataset = read_tsv_dataset(space_path.to_str().expect("UTF-8 path"))
            .expect("parse space-separated TSV");
        std::fs::remove_file(tab_path).expect("remove tab fixture");
        std::fs::remove_file(space_path).expect("remove space fixture");

        assert_eq!(tab_dataset.columns, ["name", "score"]);
        assert_eq!(tab_dataset.separator, b'\t');
        assert_eq!(space_dataset.columns, ["name", "score"]);
        assert_eq!(space_dataset.separator, b' ');
    }

    #[test]
    fn keeps_single_column_tsv_without_delimiters() {
        let path = std::env::temp_dir().join(format!(
            "coccinella-single-column-{}-{}.tsv",
            std::process::id(),
            std::thread::current().name().unwrap_or("tsv")
        ));
        std::fs::write(&path, "name\nAda\nGrace\n")
            .expect("write single-column fixture");

        let dataset = read_tsv_dataset(path.to_str().expect("UTF-8 path"))
            .expect("parse single-column TSV");
        std::fs::remove_file(path).expect("remove fixture");

        assert_eq!(dataset.columns, ["name"]);
        assert_eq!(dataset.separator, b'\t');
    }

    #[test]
    fn formats_file_sizes_with_binary_units() {
        assert_eq!(format_binary_bytes(512), "512 B");
        assert_eq!(format_binary_bytes(64 * 1024), "64.0 KiB");
        assert_eq!(format_binary_bytes(512 * 1024 * 1024), "512.0 MiB");
        assert_eq!(format_binary_bytes(1024 * 1024 * 1024), "1.0 GiB");
    }

    #[test]
    #[ignore = "generates a large fixture; set COCCINELLA_BENCHMARK_MIB to choose its size"]
    fn benchmarks_large_csv_loading() {
        use std::io::Write as _;

        let target_mib = std::env::var("COCCINELLA_BENCHMARK_MIB")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(256)
            .min(MAX_CSV_FILE_BYTES / (1024 * 1024));
        let target_bytes = target_mib * 1024 * 1024;
        let path = std::env::temp_dir().join(format!(
            "coccinella-benchmark-{}-{target_mib}.csv",
            std::process::id()
        ));
        let file = File::create(&path).expect("create benchmark fixture");
        let mut writer = std::io::BufWriter::new(file);
        writer
            .write_all(b"id,payload\n")
            .expect("write benchmark header");
        let payload = "x".repeat(2048);
        let mut bytes_written = 11_u64;
        let mut row = 0_u64;
        while bytes_written < target_bytes {
            let line = format!("{row},{payload}\n");
            writer
                .write_all(line.as_bytes())
                .expect("write benchmark row");
            bytes_written += line.len() as u64;
            row += 1;
        }
        writer.flush().expect("flush benchmark fixture");

        let started = std::time::Instant::now();
        let dataset =
            read_dataset(path.to_str().expect("UTF-8 path"), b',').expect("load benchmark fixture");
        let elapsed = started.elapsed();
        std::fs::remove_file(path).expect("remove benchmark fixture");

        assert_eq!(dataset.rows.len() as u64, row);
        eprintln!(
            "loaded {} in {:.2?} ({:.1} MiB/s)",
            format_binary_bytes(bytes_written),
            elapsed,
            bytes_written as f64 / (1024.0 * 1024.0) / elapsed.as_secs_f64()
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
    fn parses_supported_date_formats_and_unix_timestamps() {
        let expected = NaiveDate::from_ymd_opt(2026, 9, 17);

        assert_eq!(parse_date("17/09/2026"), expected);
        assert_eq!(parse_date("1789603200"), expected);
        assert_eq!(parse_date("1789603200000"), expected);
        assert!(parse_date("09/17/2026").is_none());
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
        std::fs::write(root.join("table.tsv"), "id\tname\n1\tAda\n").expect("write TSV fixture");
        std::fs::write(root.join("data.json"), "{}").expect("write JSON fixture");
        std::fs::write(nested.join("nested.CSV"), "id\n2\n").expect("write nested fixture");
        std::fs::write(deeper.join("deep.csv"), "id\n3\n").expect("write deep fixture");
        std::fs::write(root.join("notes.txt"), "ignored").expect("write text fixture");
        std::fs::write(excluded.join("excluded.csv"), "id\n4\n").expect("write excluded fixture");
        std::fs::write(hidden.join("hidden.csv"), "id\n5\n").expect("write hidden fixture");

        let mut batches = Vec::new();
        discover_data_files(&root, MAX_INDEXED_FILES, |paths| {
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

        let mut root_names = names[..3].to_vec();
        root_names.sort();
        assert_eq!(root_names, ["data.json", "root.csv", "table.tsv"]);
        assert_eq!(&names[3..], ["nested.CSV", "deep.csv"]);
    }

    #[test]
    fn reads_json_and_rejects_invalid_content() {
        let path = std::env::temp_dir().join(format!(
            "coccinella-json-{}-{}.json",
            std::process::id(),
            std::thread::current().name().unwrap_or("json")
        ));
        std::fs::write(&path, r#"{"user":{"name":"Ada"}}"#).expect("write JSON fixture");
        let (value, size_bytes) = read_json(&path.to_string_lossy()).expect("read JSON fixture");
        let value = serde_json::from_str::<serde_json::Value>(value.get()).expect("parse raw JSON");
        assert_eq!(value["user"]["name"], "Ada");
        assert!(size_bytes > 0);

        std::fs::write(&path, "{").expect("write invalid JSON fixture");
        assert!(read_json(&path.to_string_lossy()).is_err());
        std::fs::remove_file(path).expect("remove JSON fixture");
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
        discover_data_files(&root, FILE_DISCOVERY_BATCH_SIZE + 2, |paths| {
            batch_lengths.push(paths.len());
            Ok(())
        })
        .expect("discover fixture files");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");

        assert_eq!(MAX_INDEXED_FILES, 1_000);
        assert_eq!(batch_lengths, [FILE_DISCOVERY_BATCH_SIZE, 2]);
    }

    #[test]
    fn json_files_do_not_consume_the_csv_discovery_budget() {
        let root = std::env::temp_dir().join(format!(
            "coccinella-discovery-budget-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("files")
        ));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).expect("create fixture directory");
        for index in 0..3 {
            std::fs::write(root.join(format!("{index}.json")), "{}").expect("write JSON fixture");
        }
        std::fs::write(nested.join("deep.csv"), "id\n1\n").expect("write CSV fixture");

        let mut paths = Vec::new();
        discover_data_files(&root, 2, |batch| {
            paths.extend(batch);
            Ok(())
        })
        .expect("discover fixture files");
        std::fs::remove_dir_all(&root).expect("remove fixture directory");

        let kinds: Vec<_> = paths.iter().filter_map(|path| file_kind(path)).collect();
        assert_eq!(kinds.iter().filter(|kind| **kind == FileKind::Json).count(), 2);
        assert_eq!(kinds.iter().filter(|kind| **kind == FileKind::Csv).count(), 1);
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
            &Filter::Pattern(FilterSpec {
                pattern: "^Ada".into(),
                is_regex: true,
                is_case_sensitive: true,
                columns: Vec::new(),
            }),
        )
        .expect("filter rows");
        assert_eq!(filtered, [0, 2]);
        let restricted = matching_rows(
            &dataset,
            &Filter::Pattern(FilterSpec {
                pattern: "^Ada".into(),
                is_regex: true,
                is_case_sensitive: true,
                columns: vec!["score".into()],
            }),
        )
        .expect("filter selected column");
        assert!(restricted.is_empty());
        let missing_column = matching_rows(
            &dataset,
            &Filter::Expression {
                column: "removed".into(),
                condition: ExpressionCondition::Boolean { value: true },
            },
        )
        .expect("filter missing column");
        assert!(missing_column.is_empty());

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

    fn full_view(rows: &PackedRows) -> Vec<RowIndex> {
        (0..rows.len())
            .map(|index| RowIndex::try_from(index).expect("test rows fit in u32"))
            .collect()
    }

    #[test]
    fn adds_column_from_number_column_expressions() {
        let source = join_source(
            &["price", "price total", "label"],
            &[&["2", "10", "a"], &["", "4", "b"], &["4", "0", "c"]],
        );
        let number_columns = vec!["price".to_owned(), "price total".to_owned()];
        let dataset = add_expression_column(
            source,
            "ratio",
            "$price total / $price + 1",
            &number_columns,
        )
        .expect("add column");
        assert_eq!(dataset.columns, vec!["price", "price total", "label", "ratio"]);
        assert_eq!(dataset.column_types[3], "number");
        let values = owned_rows(&dataset)
            .into_iter()
            .map(|row| row[3].clone())
            .collect::<Vec<_>>();
        assert_eq!(values, vec!["6", "", "1"]);
    }

    #[test]
    fn adds_boolean_column_from_comparison_expressions() {
        let source = join_source(
            &["population", "areaInSqKm"],
            &[&["100", "10"], &["5", "50"], &["", "1"]],
        );
        let number_columns = vec!["population".to_owned(), "areaInSqKm".to_owned()];
        let dataset = add_expression_column(
            source,
            "dense",
            "$population > $areaInSqKm",
            &number_columns,
        )
        .expect("add column");
        assert_eq!(dataset.column_types[2], "boolean");
        let values = owned_rows(&dataset)
            .into_iter()
            .map(|row| row[2].clone())
            .collect::<Vec<_>>();
        assert_eq!(values, vec!["true", "false", ""]);
        let mixed = join_source(&["a"], &[&["1"], &["-1"]]);
        assert!(add_expression_column(
            mixed,
            "b",
            "if($a > 0, true, $a)",
            &["a".to_owned()],
        )
        .is_err());
    }

    #[test]
    fn rejects_invalid_added_column_expressions() {
        let source = || join_source(&["a", "b"], &[&["1", "x"]]);
        let number_columns = vec!["a".to_owned()];
        assert!(add_expression_column(source(), "c", "$b + 1", &number_columns).is_err());
        assert!(add_expression_column(source(), "a", "$a + 1", &number_columns).is_err());
        assert!(add_expression_column(source(), "c", "$a +", &number_columns).is_err());
        assert!(add_expression_column(source(), " ", "$a", &number_columns).is_err());
    }

    #[test]
    fn added_columns_share_source_storage_and_keep_the_source_order() {
        let mut source = join_source(&["a", "b"], &[&["1", "x"], &["2", "y"], &["3", "z"]]);
        source.order = Arc::new(vec![2, 0]);
        let source_rows = Arc::clone(&source.rows);
        let number_columns = vec!["a".to_owned()];
        let first = add_expression_column(source, "c", "$a * 10", &number_columns)
            .expect("add first column");
        assert!(Arc::ptr_eq(
            first.rows.prefix.as_ref().expect("shared prefix"),
            &source_rows
        ));
        assert_eq!(first.rows.column_count, 1);
        assert_eq!(owned_rows(&first), [["3", "z", "30"], ["1", "x", "10"]]);

        let second_source = JoinSource {
            columns: first.columns.clone(),
            rows: Arc::clone(&first.rows),
            order: Arc::clone(&first.order),
            column_types: first.column_types.clone(),
            separator: first.separator,
        };
        let number_columns = vec!["a".to_owned(), "c".to_owned()];
        let second = add_expression_column(second_source, "d", "$c + $a", &number_columns)
            .expect("add second column");
        assert!(Arc::ptr_eq(
            second.rows.prefix.as_ref().expect("shared prefix"),
            &source_rows
        ));
        assert_eq!(second.rows.column_count, 2);
        assert_eq!(
            owned_rows(&second),
            [["3", "z", "30", "33"], ["1", "x", "10", "11"]]
        );
    }

    #[test]
    fn plain_case_insensitive_matching_treats_pattern_literally() {
        let matcher = build_matcher(&FilterSpec {
            pattern: "a.D".into(),
            is_regex: false,
            is_case_sensitive: false,
            columns: Vec::new(),
        })
        .expect("build matcher")
        .expect("non-empty matcher");
        assert!(matcher.is_match("XA.dY"));
        assert!(!matcher.is_match("abd"));
    }

    #[test]
    fn opened_json_is_serialized_verbatim() {
        let data = RawValue::from_string(r#"{"user":{"name":"Ada"}}"#.into()).expect("raw JSON");
        let opened = OpenedFile::Json {
            filename: "a.json".into(),
            path: "/a.json".into(),
            id: "1".into(),
            data,
            size_bytes: 1,
        };
        let serialized = serde_json::to_string(&opened).expect("serialize opened file");
        assert!(serialized.contains(r#""data":{"user":{"name":"Ada"}}"#));
    }

    #[test]
    fn matches_number_expressions_against_x() {
        let rows = packed_rows(&[&["5"], &["50"], &["150"], &["abc"]]);
        let view = full_view(&rows);
        let condition = ExpressionCondition::Number {
            expression: "x > 10 && x < 200".to_owned(),
        };
        let matches = collect_expression_matches(&rows, &view, 0, &condition).expect("filter");
        assert_eq!(matches, vec![1, 2]);
    }

    #[test]
    fn matches_number_equality_and_modulo_expressions() {
        let rows = packed_rows(&[&["5"], &["10"], &["10.0"], &["15"], &["10.5"]]);
        let view = full_view(&rows);
        let matches_for = |expression: &str| {
            let condition = ExpressionCondition::Number {
                expression: expression.to_owned(),
            };
            collect_expression_matches(&rows, &view, 0, &condition).expect("filter")
        };
        assert_eq!(matches_for("x == 10"), vec![1, 2]);
        assert_eq!(matches_for("x != 10"), vec![0, 3, 4]);
        assert_eq!(matches_for("x % 2 == 0"), vec![1, 2]);
        assert_eq!(matches_for("x == 10.5"), vec![4]);
        let condition = ExpressionCondition::Number {
            expression: "x == 15".to_owned(),
        };
        assert_eq!(has_expression_match(&rows, &view, 0, &condition), Ok(true));
        let invalid = ExpressionCondition::Number {
            expression: "x > (".to_owned(),
        };
        assert!(has_expression_match(&rows, &view, 0, &invalid).is_err());
    }

    #[test]
    fn matches_dates_before_and_after() {
        let rows = packed_rows(&[&["2024-01-01"], &["2024-06-15"], &["2024-12-31"]]);
        let view = full_view(&rows);
        let before = ExpressionCondition::Date {
            date: "2024-06-15".to_owned(),
            direction: DateDirection::Before,
        };
        assert_eq!(
            collect_expression_matches(&rows, &view, 0, &before).expect("filter"),
            vec![0]
        );
        let after = ExpressionCondition::Date {
            date: "2024-06-15".to_owned(),
            direction: DateDirection::After,
        };
        assert_eq!(
            collect_expression_matches(&rows, &view, 0, &after).expect("filter"),
            vec![2]
        );
    }

    #[test]
    fn matches_boolean_values_case_insensitively() {
        let rows = packed_rows(&[&["true"], &["False"], &["TRUE"]]);
        let view = full_view(&rows);
        let condition = ExpressionCondition::Boolean { value: true };
        let matches = collect_expression_matches(&rows, &view, 0, &condition).expect("filter");
        assert_eq!(matches, vec![0, 2]);
    }

    #[test]
    fn keeps_only_rows_whose_value_is_included() {
        let rows = packed_rows(&[&["red"], &["blue"], &[""], &["green"], &["red"]]);
        let view = full_view(&rows);
        let condition = ExpressionCondition::Included {
            values: vec!["red".to_owned(), "".to_owned()],
        };
        let matches = collect_expression_matches(&rows, &view, 0, &condition).expect("filter");
        assert_eq!(matches, vec![0, 2, 4]);
    }

    #[test]
    fn rejects_invalid_or_non_boolean_number_expressions() {
        let rows = packed_rows(&[&["5"]]);
        let view = full_view(&rows);
        let invalid = ExpressionCondition::Number {
            expression: "x > (".to_owned(),
        };
        assert!(collect_expression_matches(&rows, &view, 0, &invalid).is_err());
        let non_boolean = ExpressionCondition::Number {
            expression: "x + 1".to_owned(),
        };
        assert_eq!(
            collect_expression_matches(&rows, &view, 0, &non_boolean).expect("filter"),
            Vec::<RowIndex>::new()
        );
    }
}
