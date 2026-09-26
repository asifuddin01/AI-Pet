//! API key storage.
//!
//! macOS: the login Keychain (generic password, service `com.asifuddin.aipet`).
//! Elsewhere (development only): kept in memory for the session.
//! As a development fallback, `AI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
//! environment variables are honoured when no stored key exists.
//!
//! Keys never leave the Rust process: the frontend can only ask *whether* a key exists.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::settings::Provider;

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.asifuddin.aipet";

fn account(provider: Provider) -> &'static str {
    match provider {
        Provider::OpenAi => "openai-compatible",
        Provider::Anthropic => "anthropic",
    }
}

#[derive(Default)]
pub struct SecretStore {
    /// Cache so the Keychain is queried at most once per provider per session.
    cache: Mutex<HashMap<Provider, Option<String>>>,
}

pub fn validate_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.len() < 8 || key.len() > 512 {
        return Err("That doesn't look like a valid API key.".into());
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("API keys can't contain spaces or line breaks.".into());
    }
    Ok(key)
}

fn env_key(provider: Provider) -> Option<String> {
    let specific = match provider {
        Provider::OpenAi => "OPENAI_API_KEY",
        Provider::Anthropic => "ANTHROPIC_API_KEY",
    };
    ["AI_API_KEY", specific]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
}

impl SecretStore {
    pub fn get(&self, provider: Provider) -> Option<String> {
        if let Some(cached) = self.cache.lock().ok().and_then(|c| c.get(&provider).cloned()) {
            return cached;
        }
        let value = platform::get(account(provider)).or_else(|| env_key(provider));
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(provider, value.clone());
        }
        value
    }

    pub fn has(&self, provider: Provider) -> bool {
        self.get(provider).is_some()
    }

    pub fn set(&self, provider: Provider, key: &str) -> Result<(), String> {
        let key = validate_key(key)?;
        platform::set(account(provider), key)?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(provider, Some(key.to_string()));
        }
        log::info!("API key saved for provider {}", provider.as_str());
        Ok(())
    }

    pub fn delete(&self, provider: Provider) -> Result<(), String> {
        platform::delete(account(provider))?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(provider, env_key(provider));
        }
        log::info!("API key removed for provider {}", provider.as_str());
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::SERVICE;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn get(account: &str) -> Option<String> {
        match get_generic_password(SERVICE, account) {
            Ok(bytes) => String::from_utf8(bytes).ok().filter(|s| !s.is_empty()),
            Err(e) if e.code() == NOT_FOUND => None,
            Err(e) => {
                log::warn!("Keychain read failed (code {})", e.code());
                None
            }
        }
    }

    pub fn set(account: &str, key: &str) -> Result<(), String> {
        set_generic_password(SERVICE, account, key.as_bytes()).map_err(|e| {
            log::error!("Keychain write failed (code {})", e.code());
            "I couldn't save the key to your Keychain.".to_string()
        })
    }

    pub fn delete(account: &str) -> Result<(), String> {
        match delete_generic_password(SERVICE, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => {
                log::error!("Keychain delete failed (code {})", e.code());
                Err("I couldn't remove the key from your Keychain.".into())
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    //! No persistent secure store off macOS; keys live only in the in-memory cache.
    pub fn get(_account: &str) -> Option<String> {
        None
    }

    pub fn set(_account: &str, _key: &str) -> Result<(), String> {
        log::warn!("No secure storage on this platform: API key kept in memory only");
        Ok(())
    }

    pub fn delete(_account: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation() {
        assert!(validate_key("sk-1234567890").is_ok());
        assert_eq!(validate_key("  sk-1234567890\n").unwrap(), "sk-1234567890");
        assert!(validate_key("short").is_err());
        assert!(validate_key("sk-123 4567890").is_err());
        assert!(validate_key(&"x".repeat(600)).is_err());
    }
}
