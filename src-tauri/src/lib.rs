use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tauri_plugin_sql::{Migration, MigrationKind};

mod attachments;
mod chat_title;
mod keyring_store;

const LIVE_VOICE_PORT: u16 = 8765;
const PROTOCOL_VERSION: u32 = 3;

pub struct BackendState {
    pub child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

/// Rust-side WebSocket to the Python voice backend (WebView may block `ws://` from JS).
pub struct VoiceBridgeState {
    alive: Mutex<Option<Arc<AtomicBool>>>,
    outbound: Mutex<Option<mpsc::Sender<String>>>,
}

#[derive(Clone, Serialize)]
struct BackendExitedPayload {
    code: Option<i32>,
    message: String,
}

#[derive(Clone, Serialize)]
pub struct PreflightCheck {
    pub id: String,
    pub ok: bool,
    pub message: String,
    pub required: bool,
}

#[derive(Clone, Serialize)]
pub struct PreflightResult {
    pub checks: Vec<PreflightCheck>,
    pub hard_ok: bool,
}

fn resolve_port() -> u16 {
    std::env::var("LIVE_VOICE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(LIVE_VOICE_PORT)
}

pub fn backend_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend");
        if p.is_dir() {
            return Ok(p);
        }
    }
    app.path()
        .resolve("resources/backend", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())
}

fn check_uv() -> PreflightCheck {
    match Command::new("uv").arg("--version").output() {
        Ok(out) if out.status.success() => {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            PreflightCheck {
                id: "uv".into(),
                ok: true,
                message: ver,
                required: true,
            }
        }
        Ok(out) => PreflightCheck {
            id: "uv".into(),
            ok: false,
            message: format!("uv failed (exit {:?})", out.status.code()),
            required: true,
        },
        Err(e) => PreflightCheck {
            id: "uv".into(),
            ok: false,
            message: format!("uv not found on PATH: {e}"),
            required: true,
        },
    }
}

fn check_backend_dir(app: &AppHandle) -> PreflightCheck {
    match backend_dir(app) {
        Ok(p) if p.join("pyproject.toml").is_file() => PreflightCheck {
            id: "backend_dir".into(),
            ok: true,
            message: p.display().to_string(),
            required: true,
        },
        Ok(p) => PreflightCheck {
            id: "backend_dir".into(),
            ok: false,
            message: format!("Missing pyproject.toml in {}", p.display()),
            required: true,
        },
        Err(e) => PreflightCheck {
            id: "backend_dir".into(),
            ok: false,
            message: e,
            required: true,
        },
    }
}

/// Quick WebSocket handshake + `ready` check. Must not use raw TCP — the Python server
/// expects an HTTP upgrade and logs errors if the client connects and drops.
fn probe_live_voice_backend(port: u16) -> bool {
    use tungstenite::{connect, Message};

    let url = format!("ws://127.0.0.1:{port}");
    let Ok((mut socket, _)) = connect(&url) else {
        return false;
    };
    let Ok(Message::Text(text)) = socket.read() else {
        let _ = socket.close(None);
        return false;
    };
    let ok = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|ty| ty == "ready"))
        .unwrap_or(false);
    let _ = socket.close(None);
    ok
}

fn check_port() -> PreflightCheck {
    let port = resolve_port();
    if TcpListener::bind(("127.0.0.1", port)).is_ok() {
        return PreflightCheck {
            id: "port".into(),
            ok: true,
            message: format!("Port {port} is free (app will start the backend)"),
            required: true,
        };
    }
    if probe_live_voice_backend(port) {
        return PreflightCheck {
            id: "port".into(),
            ok: true,
            message: format!(
                "Voice backend already listening on port {port} (e.g. manual uv run)"
            ),
            required: true,
        };
    }
    PreflightCheck {
        id: "port".into(),
        ok: false,
        message: format!(
            "Port {port} is in use by another program (not this app's backend). \
             Stop that process or end your manual `uv run` in a terminal, then Re-check."
        ),
        required: true,
    }
}

fn backend_already_running(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err() && probe_live_voice_backend(port)
}

fn check_lm_studio(lm_base_url: &str) -> PreflightCheck {
    let base = lm_base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return PreflightCheck {
            id: "lm_studio".into(),
            ok: false,
            message: "LM base URL is empty".into(),
            required: false,
        };
    }
    let url = format!("{base}/v1/models");
    let url_for_thread = url.clone();

    // reqwest::blocking creates an internal tokio runtime; dropping it inside the
    // outer Tauri tokio worker panics with "Cannot drop a runtime in a context
    // where blocking is not allowed". Run it on a real OS thread instead.
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .and_then(|c| c.get(&url_for_thread).send());
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(resp)) if resp.status().is_success() => PreflightCheck {
            id: "lm_studio".into(),
            ok: true,
            message: format!("Reachable at {base}"),
            required: false,
        },
        Ok(Ok(resp)) => PreflightCheck {
            id: "lm_studio".into(),
            ok: false,
            message: format!("HTTP {} from {url}", resp.status()),
            required: false,
        },
        Ok(Err(e)) => PreflightCheck {
            id: "lm_studio".into(),
            ok: false,
            message: format!("Cannot reach {url}: {e}"),
            required: false,
        },
        Err(_) => PreflightCheck {
            id: "lm_studio".into(),
            ok: false,
            message: format!("Timed out reaching {url}"),
            required: false,
        },
    }
}

#[tauri::command(rename_all = "camelCase")]
fn run_preflight(app: AppHandle, lm_base_url: Option<String>) -> PreflightResult {
    let lm = lm_base_url.unwrap_or_else(|| "http://127.0.0.1:1234".to_string());
    let checks = vec![
        check_uv(),
        check_backend_dir(&app),
        check_port(),
        check_lm_studio(&lm),
    ];
    let hard_ok = checks.iter().filter(|c| c.required).all(|c| c.ok);
    PreflightResult { checks, hard_ok }
}

#[tauri::command]
async fn start_backend(app: AppHandle, state: State<'_, BackendState>) -> Result<u16, String> {
    let pre = run_preflight(app.clone(), None);
    if !pre.hard_ok {
        return Err(
            "Preflight failed. Fix readiness checks (uv, backend folder, port) before starting."
                .into(),
        );
    }

    let port = resolve_port();

    let mut lock = state.child.lock().map_err(|e| e.to_string())?;
    if lock.is_some() {
        return Ok(port);
    }

    if backend_already_running(port) {
        return Ok(port);
    }

    let backend_dir = backend_dir(&app)?;
    let attachments_dir = attachments::attachments_dir(&app)?;

    let (mut rx, child) = app
        .shell()
        .command("uv")
        .args(["run", "python", "main.py"])
        .current_dir(&backend_dir)
        .env("LIVE_VOICE_PORT", port.to_string())
        .env(
            "LIVE_VOICE_ATTACHMENTS_DIR",
            attachments_dir.to_string_lossy().to_string(),
        )
        .spawn()
        .map_err(|e| e.to_string())?;

    let app_monitor = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stderr_tail = String::new();
        let mut exit_code: Option<i32> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let chunk = String::from_utf8_lossy(&line);
                    stderr_tail.push_str(&chunk);
                    if stderr_tail.len() > 2000 {
                        let start = stderr_tail.len().saturating_sub(1000);
                        stderr_tail = stderr_tail[start..].to_string();
                    }
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    break;
                }
                _ => {}
            }
        }

        if let Some(backend) = app_monitor.try_state::<BackendState>() {
            if let Ok(mut guard) = backend.child.lock() {
                *guard = None;
            }
        }

        let detail = stderr_tail.trim();
        let message = if detail.is_empty() {
            format!(
                "Voice backend exited (code {:?}).",
                exit_code.unwrap_or(-1)
            )
        } else {
            format!(
                "Voice backend exited (code {:?}): {}",
                exit_code.unwrap_or(-1),
                detail.chars().take(400).collect::<String>()
            )
        };

        let _ = app_monitor.emit(
            "backend-exited",
            BackendExitedPayload {
                code: exit_code,
                message,
            },
        );
    });

    *lock = Some(child);
    Ok(port)
}

fn normalize_supertonic_model(model: Option<String>) -> String {
    model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "supertonic-3".to_string())
}

fn parse_json_line(stdout: &str) -> Option<serde_json::Value> {
    for line in stdout.lines().rev() {
        let line = line.trim();
        if line.starts_with('{') {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                return Some(v);
            }
        }
    }
    None
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupertonicModelStatus {
    pub present: bool,
    pub model: String,
    pub cache_dir: String,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
async fn check_supertonic_model(
    app: AppHandle,
    model: Option<String>,
) -> Result<SupertonicModelStatus, String> {
    let backend_dir = backend_dir(&app)?;
    let model = normalize_supertonic_model(model);
    let model_for_cmd = model.clone();

    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let out = Command::new("uv")
            .current_dir(&backend_dir)
            .args([
                "run",
                "python",
                "-m",
                "live_voice.download_supertonic",
                "--check",
                "--model",
                &model_for_cmd,
            ])
            .output();
        let _ = tx.send(out);
    });
    let out = rx
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "Supertonic check timed out".to_string())?
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "Supertonic check failed (exit {}).\n{stderr}\n{stdout}",
            out.status
        ));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let v = parse_json_line(&stdout).ok_or_else(|| {
        format!("Invalid check output from download_supertonic:\n{stdout}")
    })?;

    Ok(SupertonicModelStatus {
        present: v
            .get("present")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        model: v
            .get("model")
            .and_then(|x| x.as_str())
            .unwrap_or(&model)
            .to_string(),
        cache_dir: v
            .get("cacheDir")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        message: v
            .get("message")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
async fn download_supertonic_model(
    app: AppHandle,
    model: Option<String>,
) -> Result<(), String> {
    let backend_dir = backend_dir(&app)?;
    let model = normalize_supertonic_model(model);
    let app_emit = app.clone();

    let (mut rx, _child) = app
        .shell()
        .command("uv")
        .args([
            "run",
            "python",
            "-m",
            "live_voice.download_supertonic",
            "--download",
            "--model",
            &model,
        ])
        .current_dir(backend_dir)
        .spawn()
        .map_err(|e| e.to_string())?;

    let finished = Arc::new(AtomicBool::new(false));

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let chunk = String::from_utf8_lossy(&line);
                    for json_line in chunk.lines() {
                        let json_line = json_line.trim();
                        if !json_line.starts_with('{') {
                            continue;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_line) {
                            if matches!(
                                v.get("type").and_then(|t| t.as_str()),
                                Some("error") | Some("done")
                            ) {
                                finished.store(true, Ordering::SeqCst);
                            }
                            let _ = app_emit.emit("supertonic-download", v);
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let chunk = String::from_utf8_lossy(&line).trim().to_string();
                    if !chunk.is_empty() {
                        let _ = app_emit.emit(
                            "supertonic-download",
                            serde_json::json!({
                                "type": "log",
                                "message": chunk,
                            }),
                        );
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code != Some(0) && !finished.load(Ordering::SeqCst) {
                        let _ = app_emit.emit(
                            "supertonic-download",
                            serde_json::json!({
                                "type": "error",
                                "message": format!(
                                    "Download exited with code {:?}",
                                    payload.code
                                ),
                            }),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_backend(state: State<'_, BackendState>) -> Result<(), String> {
    let mut lock = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = lock.take() {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
fn get_protocol_version() -> u32 {
    PROTOCOL_VERSION
}

fn voice_ws_disconnect_internal(state: &VoiceBridgeState) {
    if let Some(flag) = state.alive.lock().ok().and_then(|mut g| g.take()) {
        flag.store(false, Ordering::SeqCst);
    }
    if let Ok(mut out) = state.outbound.lock() {
        *out = None;
    }
}

#[tauri::command]
fn voice_ws_disconnect(state: State<'_, VoiceBridgeState>) -> Result<(), String> {
    voice_ws_disconnect_internal(&state);
    Ok(())
}

#[tauri::command]
fn voice_ws_connect(
    app: AppHandle,
    state: State<'_, VoiceBridgeState>,
    port: Option<u16>,
) -> Result<(), String> {
    voice_ws_disconnect_internal(&state);
    let port = port.unwrap_or_else(resolve_port);
    let alive = Arc::new(AtomicBool::new(true));
    let (out_tx, out_rx) = mpsc::channel::<String>();
    let (handshake_tx, handshake_rx) = mpsc::sync_channel::<Result<(), String>>(1);

    {
        let mut a = state.alive.lock().map_err(|e| e.to_string())?;
        *a = Some(alive.clone());
    }
    {
        let mut o = state.outbound.lock().map_err(|e| e.to_string())?;
        *o = Some(out_tx);
    }

    let app_emit = app.clone();
    std::thread::spawn(move || {
        use tungstenite::{connect, Message};

        let url = format!("ws://127.0.0.1:{port}");
        let connect_result = connect(&url).map_err(|e| e.to_string());

        let (mut socket, ready_text) = match connect_result {
            Ok((mut socket, _)) => match socket.read() {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<serde_json::Value>(&text) {
                        Ok(v)
                            if v.get("type").and_then(|t| t.as_str()) == Some("ready") =>
                        {
                            (socket, text.to_string())
                        }
                        _ => {
                            let _ = handshake_tx.send(Err(
                                "Voice backend handshake was not type `ready`".into(),
                            ));
                            let _ = socket.close(None);
                            return;
                        }
                    }
                }
                Ok(_) => {
                    let _ = handshake_tx.send(Err(
                        "Expected text `ready` from voice backend".into(),
                    ));
                    let _ = socket.close(None);
                    return;
                }
                Err(e) => {
                    let _ = handshake_tx.send(Err(format!("Read ready failed: {e}")));
                    let _ = socket.close(None);
                    return;
                }
            },
            Err(e) => {
                let _ = handshake_tx
                    .send(Err(format!("Connect to {url} failed: {e}")));
                return;
            }
        };

        // Unblock the JS caller immediately, then keep the socket open and
        // forward server events.
        let _ = handshake_tx.send(Ok(()));
        let _ = app_emit.emit("voice-backend-msg", ready_text);

        if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
            let _ = tcp.set_read_timeout(Some(Duration::from_millis(100)));
            let _ = tcp.set_nodelay(true);
        }

        let mut last_err: Option<String> = None;
        while alive.load(Ordering::SeqCst) {
            while let Ok(txt) = out_rx.try_recv() {
                if let Err(e) = socket.send(Message::Text(txt.into())) {
                    last_err = Some(format!("send failed: {e}"));
                    break;
                }
            }
            if last_err.is_some() {
                break;
            }
            match socket.read() {
                Ok(Message::Text(t)) => {
                    let _ = app_emit.emit("voice-backend-msg", t.to_string());
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(tungstenite::Error::Io(ref e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    last_err = Some(format!("read failed: {e}"));
                    break;
                }
            }
        }
        let _ = socket.close(None);

        if let Some(msg) = last_err {
            let _ = app_emit.emit(
                "voice-backend-msg",
                serde_json::json!({
                    "type": "error",
                    "message": msg,
                    "code": "bridge_failed",
                }),
            );
        }
    });

    handshake_rx
        .recv_timeout(Duration::from_secs(20))
        .map_err(|_| {
            voice_ws_disconnect_internal(&state);
            format!("Voice backend did not respond on ws://127.0.0.1:{port}")
        })?
        .map_err(|e| {
            voice_ws_disconnect_internal(&state);
            e
        })?;

    Ok(())
}

#[tauri::command]
fn voice_ws_send(state: State<'_, VoiceBridgeState>, message: String) -> Result<(), String> {
    let guard = state.outbound.lock().map_err(|e| e.to_string())?;
    let tx = guard
        .as_ref()
        .ok_or_else(|| "Voice bridge not connected".to_string())?;
    tx.send(message)
        .map_err(|_| "Voice bridge channel closed".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:vadana.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "create_chats_and_messages",
                            sql: include_str!("../migrations/001_init.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "message_content_format",
                            sql: include_str!("../migrations/002_message_content.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(BackendState {
            child: Mutex::new(None),
        })
        .manage(VoiceBridgeState {
            alive: Mutex::new(None),
            outbound: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            download_supertonic_model,
            check_supertonic_model,
            run_preflight,
            get_protocol_version,
            voice_ws_connect,
            voice_ws_send,
            voice_ws_disconnect,
            keyring_store::set_provider_api_key,
            keyring_store::get_provider_api_key,
            keyring_store::delete_provider_api_key,
            keyring_store::has_provider_api_key,
            chat_title::generate_chat_title,
            attachments::stage_attachment,
            attachments::get_attachments_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(bridge) = app.try_state::<VoiceBridgeState>() {
                    voice_ws_disconnect_internal(bridge.inner());
                }
                if let Some(backend) = app.try_state::<BackendState>() {
                    if let Ok(mut guard) = backend.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
