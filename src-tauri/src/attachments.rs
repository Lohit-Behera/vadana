//! Stage chat attachments under app data for the Python voice sidecar.

use std::fs;
use std::path::PathBuf;

use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StagedAttachment {
    pub id: String,
    pub kind: String,
    pub mime: String,
    pub path: String,
    pub filename: String,
}

/// Strip ``\\?\`` so Python and the WebView see normal ``C:\...`` paths.
fn path_for_client(path: &PathBuf) -> String {
    let s = path.to_string_lossy();
    const PREFIX: &str = r"\\?\";
    if s.starts_with(PREFIX) {
        s[PREFIX.len()..].to_string()
    } else {
        s.into_owned()
    }
}

pub fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn classify_kind(mime: &str, filename: &str) -> Result<&'static str, String> {
    let lower = filename.to_lowercase();
    if mime.starts_with("image/") || lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".webp") || lower.ends_with(".gif") {
        return Ok("image");
    }
    if mime == "application/pdf" || lower.ends_with(".pdf") {
        return Ok("pdf");
    }
    Err("Only images and PDF files are supported".into())
}

#[tauri::command]
pub fn get_attachments_dir(app: AppHandle) -> Result<String, String> {
    let dir = attachments_dir(&app)?;
    Ok(path_for_client(&dir))
}

#[tauri::command]
pub fn stage_attachment(
    app: AppHandle,
    bytes: Vec<u8>,
    filename: String,
    mime: String,
) -> Result<StagedAttachment, String> {
    let kind = classify_kind(&mime, &filename)?;
    let max = if kind == "pdf" { MAX_PDF_BYTES } else { MAX_IMAGE_BYTES };
    if bytes.len() > max {
        return Err(format!(
            "File exceeds size limit ({} MB)",
            max / (1024 * 1024)
        ));
    }

    let dir = attachments_dir(&app)?;
    let id = Uuid::new_v4().to_string();
    let filename_path = PathBuf::from(&filename);
    let ext = filename_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(if kind == "pdf" { "pdf" } else { "bin" });
    let dest = dir.join(format!("{id}.{ext}"));
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let mime_out = if mime.is_empty() {
        if kind == "pdf" {
            "application/pdf".to_string()
        } else {
            "image/jpeg".to_string()
        }
    } else {
        mime
    };

    Ok(StagedAttachment {
        id: id.clone(),
        kind: kind.to_string(),
        mime: mime_out,
        path: path_for_client(&dest),
        filename,
    })
}
