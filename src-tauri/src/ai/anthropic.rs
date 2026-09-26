//! Anthropic Messages API (`POST /v1/messages`, streamed), raw HTTP.

use reqwest::header::ACCEPT;
use serde_json::{json, Value};

use super::{error_body, join_path, pump_sse, AiError, AiRequest, ErrorKind, Parsed, ProviderConfig, StreamEvent};

const API_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 16_000;
const OFFICIAL_HOST: &str = "api.anthropic.com";

/// Models that accept `output_config.effort`. The pet's tasks are short, so it asks
/// for `low` effort to keep answers fast.
fn supports_effort(model: &str) -> bool {
    [
        "claude-opus-5",
        "claude-fable-5",
        "claude-mythos-5",
        "claude-sonnet-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-4-6",
    ]
    .iter()
    .any(|prefix| model.starts_with(prefix))
}

/// Models whose safety classifiers can decline a request; `fallbacks: "default"` lets
/// the API retry a declined request on Anthropic's recommended fallback model.
fn supports_default_fallbacks(model: &str) -> bool {
    model.starts_with("claude-opus-5") || model.starts_with("claude-fable-5")
}

pub fn endpoint(base: &url::Url) -> url::Url {
    let path = base.path().trim_end_matches('/');
    if path.ends_with("/v1/messages") {
        base.clone()
    } else if path.ends_with("/v1") {
        join_path(base, "messages")
    } else {
        join_path(base, "v1/messages")
    }
}

/// Newer request fields are only sent to the official API, not to third-party gateways.
pub fn build_body(model: &str, req: &AiRequest, official: bool) -> Value {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect();
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "system": req.system,
        "messages": messages,
    });
    if official && supports_effort(model) {
        body["output_config"] = json!({ "effort": "low" });
    }
    if official && supports_default_fallbacks(model) {
        body["fallbacks"] = json!("default");
    }
    body
}

fn error_kind(error_type: &str) -> ErrorKind {
    match error_type {
        "authentication_error" | "permission_error" | "billing_error" => ErrorKind::Auth,
        "rate_limit_error" => ErrorKind::RateLimit,
        "not_found_error" => ErrorKind::InvalidModel,
        "overloaded_error" | "api_error" => ErrorKind::Unavailable,
        "invalid_request_error" | "request_too_large" => ErrorKind::BadRequest,
        _ => ErrorKind::Unknown,
    }
}

pub fn parse_event(data: &str) -> Result<Parsed, AiError> {
    let v: Value = serde_json::from_str(data.trim())
        .map_err(|_| AiError::new(ErrorKind::BadResponse, "Unreadable stream event"))?;
    match v["type"].as_str().unwrap_or_default() {
        "content_block_delta" if v["delta"]["type"] == "text_delta" => {
            Ok(Parsed::Text(v["delta"]["text"].as_str().unwrap_or_default().to_string()))
        }
        // A server-side fallback took over: drop the declined model's partial answer.
        "content_block_start" if v["content_block"]["type"] == "fallback" => Ok(Parsed::Reset),
        "message_delta" if v["delta"]["stop_reason"] == "refusal" => {
            Err(AiError::new(ErrorKind::Refused, "The model declined this request"))
        }
        "message_stop" => Ok(Parsed::Done),
        "error" => {
            let kind = error_kind(v["error"]["type"].as_str().unwrap_or_default());
            Err(AiError::new(kind, "The provider reported an error mid-stream"))
        }
        _ => Ok(Parsed::Nothing),
    }
}

pub async fn stream(
    client: &reqwest::Client,
    cfg: &ProviderConfig,
    req: &AiRequest,
    emit: &mut (dyn FnMut(StreamEvent) + Send),
) -> Result<(), AiError> {
    let official = cfg.base_url.host_str() == Some(OFFICIAL_HOST);
    let body = build_body(&cfg.model, req, official);
    let key = cfg
        .api_key
        .as_deref()
        .ok_or_else(|| AiError::new(ErrorKind::NotConfigured, "No API key configured"))?;
    let mut builder = client
        .post(endpoint(&cfg.base_url))
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header(ACCEPT, "text/event-stream")
        .json(&body);
    if body.get("fallbacks").is_some() {
        builder = builder.header("anthropic-beta", FALLBACK_BETA);
    }
    let resp = builder.send().await.map_err(|e| AiError::from_reqwest(&e))?;
    let status = resp.status();
    if !status.is_success() {
        let body = error_body(resp).await;
        return Err(AiError::from_status(status.as_u16(), &body));
    }
    pump_sse(resp, |ev| parse_event(&ev.data), emit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::ChatMessage;

    fn req() -> AiRequest {
        AiRequest {
            system: "sys".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
        }
    }

    #[test]
    fn endpoint_handles_common_base_urls() {
        for (base, expected) in [
            ("https://api.anthropic.com", "https://api.anthropic.com/v1/messages"),
            ("https://api.anthropic.com/", "https://api.anthropic.com/v1/messages"),
            ("https://api.anthropic.com/v1", "https://api.anthropic.com/v1/messages"),
            ("https://gw.example.com/anthropic/v1/messages", "https://gw.example.com/anthropic/v1/messages"),
        ] {
            assert_eq!(endpoint(&url::Url::parse(base).unwrap()).as_str(), expected);
        }
    }

    #[test]
    fn body_shape() {
        let b = build_body("claude-opus-5", &req(), true);
        assert_eq!(b["system"], "sys");
        assert_eq!(b["stream"], true);
        assert_eq!(b["max_tokens"], MAX_TOKENS);
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["output_config"]["effort"], "low");
        assert_eq!(b["fallbacks"], "default");
    }

    #[test]
    fn optional_fields_only_where_supported() {
        let haiku = build_body("claude-haiku-4-5", &req(), true);
        assert!(haiku.get("output_config").is_none());
        assert!(haiku.get("fallbacks").is_none());
        let gateway = build_body("claude-opus-5", &req(), false);
        assert!(gateway.get("output_config").is_none());
        assert!(gateway.get("fallbacks").is_none());
    }

    #[test]
    fn parses_stream_events() {
        let delta = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        assert_eq!(parse_event(delta).unwrap(), Parsed::Text("Hello".into()));
        let thinking = r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"..."}}"#;
        assert_eq!(parse_event(thinking).unwrap(), Parsed::Nothing);
        assert_eq!(parse_event(r#"{"type":"message_stop"}"#).unwrap(), Parsed::Done);
        assert_eq!(parse_event(r#"{"type":"ping"}"#).unwrap(), Parsed::Nothing);
        let fallback = r#"{"type":"content_block_start","index":1,"content_block":{"type":"fallback"}}"#;
        assert_eq!(parse_event(fallback).unwrap(), Parsed::Reset);
    }

    #[test]
    fn maps_refusals_and_errors() {
        let refusal = r#"{"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":1}}"#;
        assert_eq!(parse_event(refusal).unwrap_err().kind, ErrorKind::Refused);
        let overloaded = r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;
        assert_eq!(parse_event(overloaded).unwrap_err().kind, ErrorKind::Unavailable);
        let normal_end = r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"}}"#;
        assert_eq!(parse_event(normal_end).unwrap(), Parsed::Nothing);
    }
}
