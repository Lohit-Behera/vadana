use std::collections::HashSet;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

mod attachments;
mod chat_title;
mod cleanup_manifest;
mod keyring_store;
mod knowledge;
mod llm_models;

const LIVE_VOICE_PORT: u16 = 8765;
const PROTOCOL_VERSION: u32 = 4;

pub struct BackendState {
    pub child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    pub port: Mutex<Option<u16>>,
    /// Root `uv` PID (taskkill /T tears down the Python sidecar tree on Windows).
    pub pid: Mutex<Option<u32>>,
    /// Prevents concurrent `start_backend` from spawning multiple sidecars.
    pub start_in_progress: Mutex<bool>,
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

fn first_free_port(start: u16, max_scan: u16) -> Option<u16> {
    for offset in 0..=max_scan {
        let port = start.saturating_add(offset);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
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

fn backend_venv_python(backend_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        return backend_dir.join(".venv").join("Scripts").join("python.exe");
    }
    #[cfg(not(windows))]
    {
        backend_dir.join(".venv").join("bin").join("python3")
    }
}

/// True when `.venv` is missing or older than `uv.lock` (e.g. after an app update).
fn backend_venv_needs_sync(backend_dir: &Path) -> bool {
    let venv_py = backend_venv_python(backend_dir);
    if !venv_py.is_file() {
        return true;
    }
    let lock = backend_dir.join("uv.lock");
    if !lock.is_file() {
        return false;
    }
    let Ok(lock_mtime) = lock.metadata().and_then(|m| m.modified()) else {
        return false;
    };
    let Ok(venv_mtime) = venv_py.metadata().and_then(|m| m.modified()) else {
        return true;
    };
    lock_mtime > venv_mtime
}

fn run_backend_uv_sync(backend_dir: &Path) -> Result<(), String> {
    let output = cmd_hidden("uv")
        .args(["sync", "--link-mode=copy"])
        .current_dir(backend_dir)
        .output()
        .map_err(|e| format!("Failed to run uv sync: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Backend dependencies are not installed. Run `uv sync --link-mode=copy` in the bundled backend folder.\n{stderr}"
        ));
    }
    Ok(())
}

/// Create or refresh `.venv` when missing or stale after an installer update.
fn ensure_backend_venv(app: &AppHandle, backend_dir: &Path) -> Result<(), String> {
    if backend_venv_needs_sync(backend_dir) {
        run_backend_uv_sync(backend_dir)?;
    }
    let _ = cleanup_manifest::write_uninstall_paths_manifest(app);
    Ok(())
}

/// Append Python stderr to session.log so import crashes are visible on disk.
fn persist_backend_stderr(log_file: &Path, stderr: &str, exit_code: Option<i32>) {
    if stderr.trim().is_empty() {
        return;
    }
    if let Some(parent) = log_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let body = format!(
        "\n--- backend stderr (exit code {:?}) ---\n{}\n",
        exit_code,
        stderr.trim_end()
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        let _ = file.write_all(body.as_bytes());
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
                "Port {port} has a voice backend (app will restart it on connect)"
            ),
            required: true,
        };
    }
    if let Some(fallback) = first_free_port(port.saturating_add(1), 50) {
        return PreflightCheck {
            id: "port".into(),
            ok: true,
            message: format!(
                "Port {port} is busy, but fallback port {fallback} is available (app will auto-switch)."
            ),
            required: true,
        };
    }
    PreflightCheck {
        id: "port".into(),
        ok: false,
        message: format!(
            "Port {port} is busy and no fallback port was found nearby. \
             Stop the conflicting process, then Re-check."
        ),
        required: true,
    }
}

fn parse_live_voice_ready(line: &str) -> Option<u16> {
    let line = line.trim();
    let rest = line.strip_prefix("LIVE_VOICE_READY")?;
    let port_str = rest.strip_prefix("port=")?.trim();
    port_str.parse().ok()
}

/// Drop noisy LiteLLM stderr so startup errors show the real failure.
fn summarize_backend_stderr(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.contains("LiteLLM:WARNING")
                && !line.contains("litellm: could not pre-load")
                && !line.contains("No module named 'botocore'")
        })
        .collect();
    if lines.is_empty() {
        stderr.trim().to_string()
    } else {
        lines.join("\n")
    }
}

fn pids_listening_on_port(port: u16) -> HashSet<u32> {
    let mut pids = HashSet::new();
    let port_needle = format!(":{port}");
    #[cfg(windows)]
    {
        let Ok(output) = cmd_hidden("netstat").args(["-ano"]).output() else {
            return pids;
        };
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if !line.contains("LISTENING") || !line.contains(&port_needle) {
                continue;
            }
            if let Some(pid) = line.split_whitespace().last() {
                if let Ok(n) = pid.parse::<u32>() {
                    pids.insert(n);
                }
            }
        }
    }
    #[cfg(unix)]
    {
        let Ok(output) = Command::new("sh")
            .arg("-c")
            .arg(format!("lsof -ti tcp:{port} -sTCP:LISTEN 2>/dev/null"))
            .output()
        else {
            return pids;
        };
        for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
            if let Ok(n) = pid.parse::<u32>() {
                pids.insert(n);
            }
        }
    }
    pids
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn cmd_hidden(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn kill_pid_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        let _ = cmd_hidden("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
    }
}

/// Best-effort kill of whatever is listening on the port (orphan sidecar).
fn kill_process_listening_on_port(port: u16) {
    for pid in pids_listening_on_port(port) {
        kill_pid_tree(pid);
    }
    std::thread::sleep(Duration::from_millis(150));
}

fn shutdown_voice_backend(app: &AppHandle) {
    if let Some(bridge) = app.try_state::<VoiceBridgeState>() {
        voice_ws_disconnect_internal(bridge.inner());
    }
    if let Some(backend) = app.try_state::<BackendState>() {
        // Avoid blocking the window close path on Windows: only kill the tracked PID tree.
        // Port-based scanning can stall (netstat), so keep shutdown best-effort + fast.
        let pid = backend.pid.lock().ok().and_then(|p| *p);
        std::thread::spawn(move || {
            if let Some(pid) = pid {
                kill_pid_tree(pid);
            }
        });
    }
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Pick a listen port, clearing stale listeners on the preferred port when needed.
fn allocate_backend_port(preferred: u16) -> Result<u16, String> {
    if port_is_free(preferred) {
        return Ok(preferred);
    }
    kill_process_listening_on_port(preferred);
    if port_is_free(preferred) {
        return Ok(preferred);
    }
    first_free_port(preferred.saturating_add(1), 50).ok_or_else(|| {
        format!(
            "Could not find a free local port for voice backend (preferred {preferred})."
        )
    })
}

fn stop_backend_internal(state: &BackendState) {
    let tracked_pid = state.pid.lock().ok().and_then(|p| *p);
    if let Ok(mut lock) = state.child.lock() {
        if let Some(child) = lock.take() {
            let pid = child.pid();
            let _ = child.kill();
            kill_pid_tree(pid);
        }
    }
    if let Some(pid) = tracked_pid {
        kill_pid_tree(pid);
    }

    let preferred = resolve_port();
    kill_process_listening_on_port(preferred);
    if let Some(port) = state.port.lock().ok().and_then(|p| *p) {
        if port != preferred {
            kill_process_listening_on_port(port);
        }
    }

    if let Ok(mut p) = state.port.lock() {
        *p = None;
    }
    if let Ok(mut pid) = state.pid.lock() {
        *pid = None;
    }
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

struct StartInProgressGuard<'a> {
    state: &'a BackendState,
}

impl Drop for StartInProgressGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut flag) = self.state.start_in_progress.lock() {
            *flag = false;
        }
    }
}

#[tauri::command]
async fn start_backend(app: AppHandle, state: State<'_, BackendState>) -> Result<u16, String> {
    {
        let mut starting = state.start_in_progress.lock().map_err(|e| e.to_string())?;
        if *starting {
            let port = state
                .port
                .lock()
                .ok()
                .and_then(|p| *p)
                .unwrap_or_else(resolve_port);
            if probe_live_voice_backend(port) {
                return Ok(port);
            }
            return Err(
                "Voice backend is still starting. Wait a moment and try again.".into(),
            );
        }
        *starting = true;
    }
    let _start_guard = StartInProgressGuard {
        state: state.inner(),
    };

    let pre = run_preflight(app.clone(), None);
    if !pre.hard_ok {
        return Err(
            "Preflight failed. Fix readiness checks (uv, backend folder, port) before starting."
                .into(),
        );
    }

    {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        if lock.is_some() {
            let active_port = state
                .port
                .lock()
                .map_err(|e| e.to_string())?
                .unwrap_or_else(resolve_port);
            if probe_live_voice_backend(active_port) {
                return Ok(active_port);
            }
            if let Some(child) = lock.take() {
                let _ = child.kill();
            }
            kill_process_listening_on_port(active_port);
        }
    }

    let preferred_port = resolve_port();
    let port = allocate_backend_port(preferred_port)?;
    // Always clear listeners so a stale sidecar cannot satisfy the readiness probe.
    kill_process_listening_on_port(port);
    std::thread::sleep(Duration::from_millis(400));

    let backend_dir = backend_dir(&app)?;
    ensure_backend_venv(&app, &backend_dir)?;
    let attachments_dir = attachments::attachments_dir(&app)?;
    let knowledge_dir = knowledge::knowledge_root(&app)?;
    let knowledge_index_dir = knowledge::knowledge_index_dir(&app)?;
    let log_file = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join("session.log");
    if let Some(parent) = log_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let python = backend_venv_python(&backend_dir);
    let (mut rx, child) = app
        .shell()
        .command(&python)
        .args(["main.py"])
        .current_dir(&backend_dir)
        .env("LIVE_VOICE_PORT", port.to_string())
        .env(
            "LIVE_VOICE_ATTACHMENTS_DIR",
            attachments_dir.to_string_lossy().to_string(),
        )
        .env(
            "LIVE_VOICE_KNOWLEDGE_DIR",
            knowledge_dir.to_string_lossy().to_string(),
        )
        .env(
            "LIVE_VOICE_KNOWLEDGE_INDEX_DIR",
            knowledge_index_dir.to_string_lossy().to_string(),
        )
        .env(
            "LIVE_VOICE_LOG",
            log_file.to_string_lossy().to_string(),
        )
        // Avoid uv hardlink failures when cache and .venv are on different volumes (common on Windows).
        .env("UV_LINK_MODE", "copy")
        .env("LITELLM_LOG", "ERROR")
        .spawn()
        .map_err(|e| e.to_string())?;

    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u16, String>>(1);
    let ready_sent = Arc::new(AtomicBool::new(false));
    let ready_tx = Arc::new(Mutex::new(Some(ready_tx)));

    let app_monitor = app.clone();
    let ready_sent_monitor = ready_sent.clone();
    let ready_tx_monitor = ready_tx.clone();
    let log_file_monitor = log_file.clone();
    tauri::async_runtime::spawn(async move {
        let mut stderr_tail = String::new();
        let mut exit_code: Option<i32> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let chunk = String::from_utf8_lossy(&line);
                    for line in chunk.lines() {
                        if let Some(ready_port) = parse_live_voice_ready(line) {
                            if !ready_sent_monitor.swap(true, Ordering::SeqCst) {
                                if let Some(tx) = ready_tx_monitor.lock().ok().and_then(|mut g| g.take()) {
                                    let _ = tx.send(Ok(ready_port));
                                }
                            }
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let chunk = String::from_utf8_lossy(&line);
                    stderr_tail.push_str(&chunk);
                    if stderr_tail.len() > 16_000 {
                        let start = stderr_tail.len().saturating_sub(12_000);
                        stderr_tail = stderr_tail[start..].to_string();
                    }
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code;
                    persist_backend_stderr(&log_file_monitor, &stderr_tail, exit_code);
                    if !ready_sent_monitor.load(Ordering::SeqCst) {
                        let detail = summarize_backend_stderr(&stderr_tail);
                        let log_hint = log_file_monitor.display();
                        let msg = if detail.is_empty() {
                            format!(
                                "Voice backend exited before ready (code {:?}). \
                                 Run `uv sync --link-mode=copy` in the bundled backend folder, then retry. \
                                 Details: {log_hint}",
                                exit_code.unwrap_or(-1)
                            )
                        } else {
                            format!(
                                "Voice backend exited before ready (code {:?}): {} \
                                 (full traceback in {log_hint})",
                                exit_code.unwrap_or(-1),
                                detail.chars().take(400).collect::<String>()
                            )
                        };
                        if let Some(tx) = ready_tx_monitor.lock().ok().and_then(|mut g| g.take()) {
                            let _ = tx.send(Err(msg));
                        }
                    }
                    break;
                }
                _ => {}
            }
        }

        if let Some(backend) = app_monitor.try_state::<BackendState>() {
            if let Ok(mut guard) = backend.child.lock() {
                *guard = None;
            }
            if let Ok(mut p) = backend.port.lock() {
                *p = None;
            }
            if let Ok(mut pid) = backend.pid.lock() {
                *pid = None;
            }
        }

        let detail = summarize_backend_stderr(&stderr_tail);
        let message = if detail.is_empty() {
            format!(
                "Voice backend exited (code {:?}). \
                 If this persists, close other Vadana/terminal sessions and run \
                 `cd backend && uv sync --link-mode=copy`.",
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

    let uv_pid = child.pid();
    {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        *lock = Some(child);
    }
    if let Ok(mut pid_guard) = state.pid.lock() {
        *pid_guard = Some(uv_pid);
    }

    let log_file_hint = log_file.display().to_string();
    let ready_result = tauri::async_runtime::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        // Do not probe immediately: a stale listener on the port causes a false ready.
        let probe_after = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            if std::time::Instant::now() >= deadline {
                return Err(format!(
                    "Voice backend did not become ready within 120s. \
                     Run `uv sync --link-mode=copy` in the bundled backend folder. \
                     Log: {log_file_hint}"
                ));
            }
            match ready_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if std::time::Instant::now() >= probe_after
                        && probe_live_voice_backend(port)
                    {
                        return Ok(port);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Voice backend ready channel closed unexpectedly.".into());
                }
            }
        }
    })
    .await
    .map_err(|_| "Voice backend wait task failed.".to_string())?;

    let ready_port = match ready_result {
        Ok(p) => p,
        Err(e) => {
            stop_backend_internal(state.inner());
            return Err(e);
        }
    };

    if !probe_live_voice_backend(ready_port) {
        stop_backend_internal(state.inner());
        return Err(format!(
            "Voice backend reported ready on port {ready_port} but WebSocket probe failed."
        ));
    }

    if let Ok(mut p) = state.port.lock() {
        *p = Some(ready_port);
    }
    Ok(ready_port)
}

pub(crate) fn default_models_root_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("vadana")
        .join("models")
}

fn supertonic_cli_args(
    model: &str,
    flag: &str,
    models_root: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "python".to_string(),
        "-m".to_string(),
        "live_voice.download_supertonic".to_string(),
        flag.to_string(),
        "--model".to_string(),
        model.to_string(),
    ];
    if let Some(root) = models_root.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--models-root".to_string());
        args.push(root.to_string());
    }
    args
}

#[tauri::command]
fn default_models_root() -> String {
    default_models_root_path().to_string_lossy().into_owned()
}

#[tauri::command(rename_all = "camelCase")]
fn pick_models_folder(current: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(cur) = current.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(cur);
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    } else {
        let default = default_models_root_path();
        if default.is_dir() {
            dialog = dialog.set_directory(default);
        }
    }
    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
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
    models_root: Option<String>,
) -> Result<SupertonicModelStatus, String> {
    let backend_dir = backend_dir(&app)?;
    let model = normalize_supertonic_model(model);
    let model_for_cmd = model.clone();
    let uv_args = supertonic_cli_args(&model_for_cmd, "--check", models_root.as_deref());

    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let out = Command::new("uv")
            .current_dir(&backend_dir)
            .args(&uv_args)
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
    models_root: Option<String>,
) -> Result<(), String> {
    let backend_dir = backend_dir(&app)?;
    let model = normalize_supertonic_model(model);
    let app_emit = app.clone();
    let uv_args = supertonic_cli_args(&model, "--download", models_root.as_deref());

    let (mut rx, _child) = app
        .shell()
        .command("uv")
        .args(&uv_args)
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
    stop_backend_internal(state.inner());
    Ok(())
}

#[tauri::command]
fn chat_database_path(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("vadana.db").display().to_string())
}

#[tauri::command]
fn voice_backend_log_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map_err(|e| e.to_string())
        .map(|dir| dir.join("session.log").display().to_string())
}

/// Remove the local chat DB when migrations were applied then changed (dev upgrades).
#[tauri::command]
fn refresh_uninstall_paths(app: AppHandle) -> Result<(), String> {
    cleanup_manifest::write_uninstall_paths_manifest(&app)
}

#[tauri::command]
fn reset_chat_database(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("vadana.db");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))?;
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                        Migration {
                            version: 3,
                            description: "knowledge_base",
                            sql: include_str!("../migrations/003_knowledge.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "chat_system_prompt",
                            sql: include_str!("../migrations/004_chat_system_prompt.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "chat_supertonic_tts",
                            sql: include_str!("../migrations/005_chat_tts.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 6,
                            description: "chat_llm",
                            sql: include_str!("../migrations/006_chat_llm.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .manage(BackendState {
            child: Mutex::new(None),
            port: Mutex::new(None),
            pid: Mutex::new(None),
            start_in_progress: Mutex::new(false),
        })
        .manage(VoiceBridgeState {
            alive: Mutex::new(None),
            outbound: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            chat_database_path,
            voice_backend_log_path,
            reset_chat_database,
            refresh_uninstall_paths,
            download_supertonic_model,
            check_supertonic_model,
            default_models_root,
            pick_models_folder,
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
            knowledge::get_knowledge_dirs,
            knowledge::ensure_knowledge_folder,
            knowledge::import_knowledge_file,
            knowledge::delete_knowledge_file_on_disk,
            knowledge::rebuild_knowledge_index,
            llm_models::list_llm_models,
        ])
        .setup(|app| {
            let _ = cleanup_manifest::write_uninstall_paths_manifest(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                }
                => {
                    // Show "closing" UI and force exit after cleanup.
                    api.prevent_close();
                    let _ = app.emit("app-closing", ());
                    shutdown_voice_backend(app);
                    let app2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(900));
                        app2.exit(0);
                    });
                }
                | tauri::RunEvent::ExitRequested { .. }
                | tauri::RunEvent::Exit => shutdown_voice_backend(app),
                _ => {}
            }
        });
}
