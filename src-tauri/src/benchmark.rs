use super::{queue_opened_files, validate_data_path, AppState};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, State};

const BENCHMARK_FILE_ENV: &str = "COCCINELLA_BENCHMARK_FILE";
const BENCHMARK_FAILURE_EXIT_CODE: i32 = 1;

pub struct Benchmark {
    pub enabled: bool,
    pub exit_code: Arc<AtomicI32>,
}

pub fn initialize(state: &AppState) -> Result<Benchmark, String> {
    let Some(path) = std::env::var_os(BENCHMARK_FILE_ENV) else {
        return Ok(Benchmark {
            enabled: false,
            exit_code: Arc::new(AtomicI32::new(0)),
        });
    };
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    validate_data_path(&path.to_string_lossy())?;
    if !path.is_file() {
        return Err("Benchmark input must be a file".into());
    }
    let url = tauri::Url::from_file_path(path).map_err(|_| "Invalid benchmark file path")?;
    queue_opened_files(&[url], state)?;
    Ok(Benchmark {
        enabled: true,
        exit_code: Arc::new(AtomicI32::new(0)),
    })
}

#[tauri::command]
pub fn benchmark_enabled(state: State<'_, Benchmark>) -> bool {
    state.enabled
}

#[tauri::command]
pub fn finish_benchmark(app: AppHandle, state: State<'_, Benchmark>, error: Option<String>) {
    if !state.enabled {
        return;
    }
    let exit_code = if let Some(error) = error {
        eprintln!("benchmark failed: {error}");
        BENCHMARK_FAILURE_EXIT_CODE
    } else {
        0
    };
    if exit_code != 0 {
        state.exit_code.store(exit_code, Ordering::Relaxed);
    }
    app.exit(exit_code);
}
