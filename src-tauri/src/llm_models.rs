use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedModel {
    pub id: String,
    pub provider: String,
}

#[derive(Deserialize)]
struct OpenAiModelsResponse {
    data: Option<Vec<OpenAiModelEntry>>,
}

#[derive(Deserialize)]
struct OpenAiModelEntry {
    id: String,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Option<Vec<OllamaModelEntry>>,
}

#[derive(Deserialize)]
struct OllamaModelEntry {
    name: String,
}

fn normalize_openai_base(base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return base;
    }
    if !base.ends_with("/v1") {
        base.push_str("/v1");
    }
    base
}

fn ollama_root(base_url: &str) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    if base.ends_with("/v1") {
        base.truncate(base.len().saturating_sub(3));
        base = base.trim_end_matches('/').to_string();
    }
    if base.is_empty() {
        "http://127.0.0.1:11434".to_string()
    } else {
        base
    }
}

fn default_base(provider: &str) -> &'static str {
    match provider {
        "ollama" => "http://127.0.0.1:11434",
        "openai" => "https://api.openai.com/v1",
        "groq" => "https://api.groq.com/openai/v1",
        _ => "http://127.0.0.1:1234",
    }
}

fn fetch_openai_compatible(
    client: &Client,
    models_url: &str,
    api_key: Option<&str>,
    provider: &str,
) -> Result<Vec<ListedModel>, String> {
    let mut req = client.get(models_url);
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }
    let resp = req
        .send()
        .map_err(|e| format!("Could not reach {models_url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Model list failed (HTTP {}): {}",
            resp.status(),
            resp.text().unwrap_or_default()
        ));
    }
    let body: OpenAiModelsResponse = resp
        .json()
        .map_err(|e| format!("Invalid models JSON: {e}"))?;
    let mut out: Vec<ListedModel> = body
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|m| ListedModel {
            id: m.id,
            provider: provider.to_string(),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    Ok(out)
}

fn fetch_ollama(client: &Client, root: &str) -> Result<Vec<ListedModel>, String> {
    let url = format!("{}/api/tags", root.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Could not reach Ollama at {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Ollama model list failed (HTTP {}): {}",
            resp.status(),
            resp.text().unwrap_or_default()
        ));
    }
    let body: OllamaTagsResponse = resp
        .json()
        .map_err(|e| format!("Invalid Ollama JSON: {e}"))?;
    let mut out: Vec<ListedModel> = body
        .models
        .unwrap_or_default()
        .into_iter()
        .map(|m| ListedModel {
            id: m.name,
            provider: "ollama".to_string(),
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn anthropic_catalog() -> Vec<ListedModel> {
    [
        "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
    ]
    .into_iter()
    .map(|id| ListedModel {
        id: id.to_string(),
        provider: "anthropic".to_string(),
    })
    .collect()
}

#[tauri::command]
pub fn list_llm_models(
    provider: String,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<Vec<ListedModel>, String> {
    let prov = provider.trim().to_lowercase();
    if prov.is_empty() {
        return Err("Provider is required".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let key = api_key.as_deref();

    match prov.as_str() {
        "anthropic" => Ok(anthropic_catalog()),
        "ollama" => {
            let root = ollama_root(base_url.as_deref().unwrap_or(default_base("ollama")));
            fetch_ollama(&client, &root)
        }
        "openai" => {
            let base = normalize_openai_base(base_url.as_deref().unwrap_or(default_base("openai")));
            fetch_openai_compatible(
                &client,
                &format!("{base}/models"),
                key,
                "openai",
            )
        }
        "groq" => {
            let base = normalize_openai_base(base_url.as_deref().unwrap_or(default_base("groq")));
            fetch_openai_compatible(&client, &format!("{base}/models"), key, "groq")
        }
        "lm_studio" | "lmstudio" => {
            let base = normalize_openai_base(base_url.as_deref().unwrap_or(default_base("lm_studio")));
            fetch_openai_compatible(&client, &format!("{base}/models"), key, "lm_studio")
        }
        _ => Err(format!("Unsupported provider: {prov}")),
    }
}
