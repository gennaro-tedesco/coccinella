// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_csv_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_csv_files() -> Result<Vec<String>, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
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
        .map_err(|e| format!("fd not found: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.to_string())
        .collect())
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
        .map_err(|e| format!("fzf not found: {e}"))?;
    child
        .stdin
        .as_mut()
        .ok_or("failed to open fzf stdin")?
        .write_all(candidates.join("\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.to_string())
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_csv_file,
            list_csv_files,
            fuzzy_filter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
