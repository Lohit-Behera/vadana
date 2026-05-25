//! Knowledge document folders on disk for the Python sidecar.

use std::fs;
use std::path::{Path, PathBuf};

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};

use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;

fn path_for_client(path: &Path) -> String {
    let s = path.to_string_lossy();
    const PREFIX: &str = r"\\?\";
    if s.starts_with(PREFIX) {
        s[PREFIX.len()..].to_string()
    } else {
        s.into_owned()
    }
}

pub fn knowledge_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("knowledge");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn knowledge_index_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = knowledge_root(app)?.join("index");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn folder_dir(app: &AppHandle, folder_id: &str) -> Result<PathBuf, String> {
    let id = folder_id.trim();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid folder id".into());
    }
    let dir = knowledge_root(app)?.join("folders").join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn classify_mime(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.ends_with(".md") {
        return "text/markdown".into();
    }
    if lower.ends_with(".pdf") {
        return "application/pdf".into();
    }
    if lower.ends_with(".docx") {
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into();
    }
    if lower.ends_with(".xlsx") {
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into();
    }
    "application/octet-stream".into()
}

fn allowed_extension(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".pdf")
        || lower.ends_with(".docx")
        || lower.ends_with(".xlsx")
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedKnowledgeFile {
    pub id: String,
    pub rel_path: String,
    pub absolute_path: String,
    pub filename: String,
    pub mime: String,
    pub size_bytes: usize,
}

#[tauri::command]
pub fn get_knowledge_dirs(app: AppHandle) -> Result<serde_json::Value, String> {
    let root = knowledge_root(&app)?;
    let index = knowledge_index_dir(&app)?;
    Ok(serde_json::json!({
        "knowledgeDir": path_for_client(&root),
        "knowledgeIndexDir": path_for_client(&index),
    }))
}

#[tauri::command]
pub fn ensure_knowledge_folder(app: AppHandle, folder_id: String) -> Result<(), String> {
    let _ = folder_dir(&app, &folder_id)?;
    Ok(())
}

#[tauri::command]
pub fn import_knowledge_file(
    app: AppHandle,
    folder_id: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<ImportedKnowledgeFile, String> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File exceeds size limit ({} MB)",
            MAX_FILE_BYTES / (1024 * 1024)
        ));
    }
    let name = filename.trim();
    if name.is_empty() || !allowed_extension(name) {
        return Err("Supported types: .md, .pdf, .docx, .xlsx".into());
    }
    let dir = folder_dir(&app, &folder_id)?;
    let id = Uuid::new_v4().to_string();
    let dest_name = format!("{id}_{}", Path::new(name).file_name().and_then(|s| s.to_str()).unwrap_or("file"));
    let dest = dir.join(&dest_name);
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let rel = format!("folders/{folder_id}/{dest_name}");
    Ok(ImportedKnowledgeFile {
        id: id.clone(),
        rel_path: rel,
        absolute_path: path_for_client(&dest),
        filename: name.to_string(),
        mime: classify_mime(name),
        size_bytes: bytes.len(),
    })
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCharUpdate {
    pub id: String,
    pub char_count: i64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RebuildKnowledgeResult {
    pub ok: bool,
    pub doc_count: u32,
    pub node_count: u32,
    pub error: Option<String>,
    pub char_updates: Vec<KnowledgeCharUpdate>,
}

fn rebuild_python_exe(backend_dir: &PathBuf) -> PathBuf {
    #[cfg(windows)]
    let venv = backend_dir.join(".venv/Scripts/python.exe");
    #[cfg(not(windows))]
    let venv = backend_dir.join(".venv/bin/python");
    if venv.is_file() {
        return venv;
    }
    PathBuf::from("python")
}

fn handle_rebuild_line(
    app_emit: &AppHandle,
    line: &str,
    last_done: &Arc<Mutex<Option<serde_json::Value>>>,
    last_error_msg: &Arc<Mutex<Option<String>>>,
) {
    let line = line.trim();
    if !line.starts_with('{') {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return;
    };
    let ty = v.get("type").and_then(|t| t.as_str()).map(str::to_string);
    if ty.as_deref() == Some("done") {
        *last_done.lock().unwrap() = Some(v.clone());
    }
    if ty.as_deref() == Some("error") {
        *last_error_msg.lock().unwrap() = v
            .get("message")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string());
    }
    let _ = app_emit.emit("knowledge-rebuild", v);
}

fn parse_rebuild_done(v: &serde_json::Value) -> RebuildKnowledgeResult {
    let char_updates: Vec<KnowledgeCharUpdate> = v
        .get("charUpdates")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(KnowledgeCharUpdate {
                        id: item.get("id")?.as_str()?.to_string(),
                        char_count: item.get("charCount")?.as_i64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    RebuildKnowledgeResult {
        ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false),
        doc_count: v.get("doc_count").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        node_count: v.get("node_count").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
        error: v
            .get("error")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        char_updates,
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rebuild_knowledge_index(
    app: AppHandle,
    catalog: serde_json::Value,
) -> Result<RebuildKnowledgeResult, String> {
    let backend_dir = crate::backend_dir(&app)?;
    let knowledge_dir = knowledge_root(&app)?;
    let knowledge_index_dir = knowledge_index_dir(&app)?;
    let catalog_json = serde_json::to_string(&catalog).map_err(|e| e.to_string())?;
    let catalog_path = knowledge_dir.join(".rebuild_catalog.json");
    fs::write(&catalog_path, &catalog_json).map_err(|e| e.to_string())?;
    let catalog_arg = catalog_path.to_string_lossy().to_string();

    let python = rebuild_python_exe(&backend_dir);
    let using_venv = python.file_name().is_some_and(|n| n == "python.exe" || n == "python");

    let _ = app.emit(
        "knowledge-rebuild",
        serde_json::json!({
            "type": "progress",
            "message": if using_venv {
                "Starting Python indexer…"
            } else {
                "Starting Python indexer (run `uv sync` in backend/ if this hangs)…"
            },
            "phase": "start",
            "percent": 2
        }),
    );

    let (result_tx, result_rx) = mpsc::sync_channel::<Result<RebuildKnowledgeResult, String>>(1);
    let app_emit = app.clone();
    let knowledge_dir_s = knowledge_dir.to_string_lossy().to_string();
    let knowledge_index_dir_s = knowledge_index_dir.to_string_lossy().to_string();

    std::thread::spawn(move || {
        let last_done: Arc<Mutex<Option<serde_json::Value>>> = Arc::new(Mutex::new(None));
        let last_error_msg: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

        let mut child = match Command::new(&python)
            .current_dir(&backend_dir)
            .args([
                "-u",
                "-m",
                "live_voice.rebuild_knowledge",
                "--catalog-file",
                catalog_arg.as_str(),
            ])
            .env("HF_HUB_DISABLE_XET", "1")
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("LIVE_VOICE_KNOWLEDGE_DIR", &knowledge_dir_s)
            .env("LIVE_VOICE_KNOWLEDGE_INDEX_DIR", &knowledge_index_dir_s)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = result_tx.send(Err(format!("Failed to start Python: {e}")));
                return;
            }
        };

        let stdout_handle = if let Some(stdout) = child.stdout.take() {
            let app_out = app_emit.clone();
            let ld = Arc::clone(&last_done);
            let le = Arc::clone(&last_error_msg);
            Some(std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    match line {
                        Ok(l) => handle_rebuild_line(&app_out, &l, &ld, &le),
                        Err(_) => break,
                    }
                }
            }))
        } else {
            None
        };

        if let Some(stderr) = child.stderr.take() {
            let app_err = app_emit.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    let chunk = line.trim();
                    if chunk.is_empty() {
                        continue;
                    }
                    let _ = app_err.emit(
                        "knowledge-rebuild",
                        serde_json::json!({
                            "type": "log",
                            "message": chunk,
                        }),
                    );
                }
            });
        }

        let status = child.wait();
        if let Some(h) = stdout_handle {
            let _ = h.join();
        }

        let outcome = if let Some(v) = last_done.lock().unwrap().clone() {
            let parsed = parse_rebuild_done(&v);
            if parsed.ok {
                Ok(parsed)
            } else {
                Err(parsed
                    .error
                    .clone()
                    .unwrap_or_else(|| "Knowledge index rebuild failed".to_string()))
            }
        } else if let Some(msg) = last_error_msg.lock().unwrap().clone() {
            Err(msg)
        } else if let Err(e) = status {
            Err(format!("Python process failed: {e}"))
        } else {
            Err("Knowledge index rebuild ended without a result".to_string())
        };
        let _ = result_tx.send(outcome);
    });

    result_rx
        .recv_timeout(std::time::Duration::from_secs(1800))
        .map_err(|_| "Knowledge index rebuild timed out (30 min)".to_string())?
}

#[tauri::command]
pub fn delete_knowledge_file_on_disk(app: AppHandle, rel_path: String) -> Result<(), String> {
    let rel = rel_path.trim().replace('\\', "/");
    if rel.contains("..") || !rel.starts_with("folders/") {
        return Err("Invalid knowledge file path".into());
    }
    let path = knowledge_root(&app)?.join(&rel);
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
