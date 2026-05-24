//! OS keychain storage for LLM provider API keys.

use keyring::Entry;

const SERVICE: &str = "com.lohit.vadana";

fn entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_provider_api_key(provider: String, key: String) -> Result<(), String> {
    let e = entry(&provider)?;
    e.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_provider_api_key(provider: String) -> Result<String, String> {
    let e = entry(&provider)?;
    e.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_provider_api_key(provider: String) -> Result<(), String> {
    let e = entry(&provider)?;
    e.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn has_provider_api_key(provider: String) -> Result<bool, String> {
    match get_provider_api_key(provider) {
        Ok(k) if !k.is_empty() => Ok(true),
        Ok(_) => Ok(false),
        Err(_) => Ok(false),
    }
}
