//! Paths to remove when the user uninstalls with "Delete application data" checked.
//! Custom models folders and backend `.venv` are stored in `uninstall-paths.json`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{backend_dir, default_models_root_path};

const MANIFEST_FILE: &str = "uninstall-paths.json";

#[derive(Debug, Serialize, Deserialize)]
struct UninstallPathsManifest {
    paths: Vec<String>,
}

fn read_models_root_from_settings(app: &AppHandle) -> Option<PathBuf> {
    let path = app.path().app_data_dir().ok()?.join("voice-settings.json");
    if !path.is_file() {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let raw = v
        .get("settings")
        .and_then(|s| s.get("modelsRoot"))
        .and_then(|m| m.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    Some(PathBuf::from(raw))
}

fn push_path(paths: &mut Vec<String>, path: PathBuf) {
    let s = path.to_string_lossy().trim().to_string();
    if s.is_empty() {
        return;
    }
    if paths.iter().any(|p| p.eq_ignore_ascii_case(&s)) {
        return;
    }
    paths.push(s);
}

fn legacy_vadana_dirs(paths: &mut Vec<String>) {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        push_path(paths, PathBuf::from(local).join("vadana"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        push_path(paths, PathBuf::from(&profile).join("vadana"));
    }
}

/// Collect models dir, backend `.venv`, and legacy folders for uninstall cleanup.
pub fn collect_uninstall_paths(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();

    if let Some(custom) = read_models_root_from_settings(app) {
        push_path(&mut paths, custom);
    } else {
        push_path(&mut paths, default_models_root_path());
    }

    legacy_vadana_dirs(&mut paths);

    if let Ok(backend) = backend_dir(app) {
        let venv = backend.join(".venv");
        if venv.is_dir() {
            push_path(&mut paths, venv);
        }
    }

    Ok(paths)
}

pub fn write_uninstall_paths_manifest(app: &AppHandle) -> Result<(), String> {
    let paths = collect_uninstall_paths(app)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = UninstallPathsManifest { paths };
    let json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize manifest: {e}"))?;
    std::fs::write(dir.join(MANIFEST_FILE), json).map_err(|e| e.to_string())
}
