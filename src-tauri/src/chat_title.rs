//! Generate chat sidebar titles via LLM (Rust HTTP — avoids WebView CORS to LM Studio).

use serde::Serialize;
use serde_json::Value;

use crate::keyring_store;

const TITLE_SYSTEM: &str = "You generate short chat titles for a sidebar. Given a brief conversation snippet, reply with ONLY a concise title (3–6 words). No quotes, no colons at the end, no explanation.";

#[derive(Debug, Serialize)]
pub struct GenerateChatTitleResult {
    pub title: Option<String>,
    pub http_status: u16,
    pub response_body: String,
    pub error: Option<String>,
    pub used_fallback: bool,
}

fn normalize_api_base(url: &str) -> String {
    let base = url.trim().trim_end_matches('/');
    if base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1")
    }
}

fn strip_model_prefix(model: &str, prefix: &str) -> String {
    let p = format!("{prefix}/");
    if model.starts_with(&p) {
        model[p.len()..].to_string()
    } else {
        model.to_string()
    }
}

fn sanitize_title(raw: &str) -> Option<String> {
    let mut t: String = raw
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if t.is_empty() || t.eq_ignore_ascii_case("new chat") {
        return None;
    }
    if t.chars().count() > 48 {
        let short: String = t.chars().take(48).collect();
        t = format!("{short}…");
    }
    Some(t)
}

fn extract_openai_title(data: &Value) -> Option<String> {
    let choices = data.get("choices")?.as_array()?;
    let choice = choices.first()?;
    if let Some(content) = choice
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
    {
        if !content.trim().is_empty() {
            return sanitize_title(content);
        }
    }
    if let Some(reasoning) = choice
        .get("message")
        .and_then(|m| m.get("reasoning_content"))
        .and_then(|c| c.as_str())
    {
        if let Some(last) = reasoning
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .last()
        {
            if last.len() < 80 {
                return sanitize_title(last);
            }
        }
    }
    if let Some(text) = choice.get("text").and_then(|t| t.as_str()) {
        if !text.trim().is_empty() {
            return sanitize_title(text);
        }
    }
    None
}

fn extract_anthropic_title(data: &Value) -> Option<String> {
    let content = data.get("content")?.as_array()?;
    for block in content {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                if let Some(t) = sanitize_title(text) {
                    return Some(t);
                }
            }
        }
    }
    None
}

fn openai_style_request(
    url: &str,
    model: &str,
    api_key: Option<&str>,
    snippet: &str,
) -> Result<(u16, String), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": TITLE_SYSTEM },
            { "role": "user", "content": snippet }
        ],
        "max_tokens": 128,
        "temperature": 0.4,
        "stream": false
    });

    let body_str = body.to_string();
    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(body_str);

    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {key}"));
    }

    eprintln!(
        "[Vadana:chat-title] POST {url} model={model} snippet_len={}",
        snippet.len()
    );

    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().map_err(|e| e.to_string())?;
    eprintln!("[Vadana:chat-title] HTTP {status} body_len={}", text.len());
    Ok((status, text))
}

fn anthropic_request(model: &str, api_key: &str, snippet: &str) -> Result<(u16, String), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 64,
        "system": TITLE_SYSTEM,
        "messages": [{ "role": "user", "content": snippet }]
    });

    eprintln!("[Vadana:chat-title] POST anthropic model={model}");

    let body_str = body.to_string();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .body(body_str)
        .send()
        .map_err(|e| e.to_string())?;

    let status = res.status().as_u16();
    let text = res.text().map_err(|e| e.to_string())?;
    Ok((status, text))
}

#[tauri::command]
pub fn generate_chat_title(
    provider: String,
    model: String,
    lm_base_url: String,
    snippet: String,
) -> Result<GenerateChatTitleResult, String> {
    let prov = provider.trim().to_lowercase();
    let raw_model = model.trim();

    let (http_status, response_body, title, error) = if prov == "anthropic" {
        let key = match keyring_store::get_provider_api_key("anthropic".to_string()) {
            Ok(k) if !k.is_empty() => k,
            _ => {
                return Ok(GenerateChatTitleResult {
                    title: None,
                    http_status: 0,
                    response_body: String::new(),
                    error: Some("Anthropic API key missing".into()),
                    used_fallback: true,
                });
            }
        };
        let m = strip_model_prefix(raw_model, "anthropic");
        match anthropic_request(&m, &key, &snippet) {
            Ok((status, body)) => {
                let title = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| extract_anthropic_title(&v));
                let err = if status >= 400 {
                    Some(format!("HTTP {status}"))
                } else if title.is_none() {
                    Some("No title in response".into())
                } else {
                    None
                };
                (status, body, title, err)
            }
            Err(e) => {
                return Ok(GenerateChatTitleResult {
                    title: None,
                    http_status: 0,
                    response_body: String::new(),
                    error: Some(e),
                    used_fallback: true,
                });
            }
        }
    } else {
        let (url, api_model, api_key): (String, String, Option<String>) = match prov.as_str() {
            "lm_studio" => (
                format!("{}/chat/completions", normalize_api_base(&lm_base_url)),
                strip_model_prefix(raw_model, "lm_studio"),
                Some("lm-studio".to_string()),
            ),
            "openai" => {
                let key = keyring_store::get_provider_api_key("openai".to_string()).ok();
                (
                    "https://api.openai.com/v1/chat/completions".to_string(),
                    strip_model_prefix(raw_model, "openai"),
                    key.filter(|k| !k.is_empty()),
                )
            }
            "groq" => {
                let key = keyring_store::get_provider_api_key("groq".to_string()).ok();
                (
                    "https://api.groq.com/openai/v1/chat/completions".to_string(),
                    strip_model_prefix(raw_model, "groq"),
                    key.filter(|k| !k.is_empty()),
                )
            }
            "ollama" => {
                let base = if lm_base_url.trim().is_empty() {
                    "http://127.0.0.1:11434"
                } else {
                    lm_base_url.trim()
                };
                (
                    format!("{}/chat/completions", normalize_api_base(base)),
                    strip_model_prefix(raw_model, "ollama"),
                    None,
                )
            }
            _ => (
                format!("{}/chat/completions", normalize_api_base(&lm_base_url)),
                strip_model_prefix(raw_model, "lm_studio"),
                Some("lm-studio".to_string()),
            ),
        };

        if matches!(prov.as_str(), "openai" | "groq") && api_key.is_none() {
            return Ok(GenerateChatTitleResult {
                title: None,
                http_status: 0,
                response_body: String::new(),
                error: Some(format!("{prov} API key missing")),
                used_fallback: true,
            });
        }

        match openai_style_request(&url, &api_model, api_key.as_deref(), &snippet) {
            Ok((status, body)) => {
                let title = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| extract_openai_title(&v));
                let err = if status >= 400 {
                    Some(format!("HTTP {status}"))
                } else if title.is_none() {
                    Some("No title in response".into())
                } else {
                    None
                };
                (status, body, title, err)
            }
            Err(e) => {
                return Ok(GenerateChatTitleResult {
                    title: None,
                    http_status: 0,
                    response_body: String::new(),
                    error: Some(e),
                    used_fallback: true,
                });
            }
        }
    };

    if let Some(ref t) = title {
        eprintln!("[Vadana:chat-title] extracted title: {t}");
    } else if let Some(ref e) = error {
        eprintln!("[Vadana:chat-title] failed: {e}");
    }

    Ok(GenerateChatTitleResult {
        title,
        http_status,
        response_body,
        error,
        used_fallback: false,
    })
}
