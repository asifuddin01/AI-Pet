//! OpenAI-compatible `/chat/completions` (OpenAI, Ollama, LM Studio, OpenRouter, Groq, ...).

use reqwest::header::{ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};

use super::{error_body, join_path, pump_sse, AiError, AiRequest, ErrorKind, Parsed, ProviderConfig, StreamEvent};

pub fn build_body(model: &str, req: &AiRequest) -> Value {
    let mut messages = vec![json!({ "role": "system", "content": req.system })];
    messages.extend(
        req.messages
            .iter()
            .map(|m| json!({ "role": m.role, "content": m.content })),
    );
    json!({ "model": model, "stream": true, "messages": messages })
}

pub fn parse_event(data: &str) -> Result<Parsed, AiError> {
    let data = data.trim();
    if data == "[DONE]" {
        return Ok(Parsed::Done);
    }
    if data.is_empty() {
        return Ok(Parsed::Nothing);
    }
    let v: Value = serde_json::from_str(data)
        .map_err(|_| AiError::new(ErrorKind::BadResponse, "Unreadable stream event"))?;
    if v.get("error").is_some_and(|e| !e.is_null()) {
        return Err(AiError::new(ErrorKind::Unavailable, "The provider reported an error mid-stream"));
    }
    let text = v
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(Parsed::Text(text.to_string()))
}

/// Some servers ignore `stream: true` and answer with a single JSON document.
pub fn parse_full(body: &str) -> Result<String, AiError> {
    let v: Value = serde_json::from_str(body)
        .map_err(|_| AiError::new(ErrorKind::BadResponse, "Unreadable response"))?;
    v.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AiError::new(ErrorKind::BadResponse, "Response had no text"))
}

pub async fn stream(
    client: &reqwest::Client,
    cfg: &ProviderConfig,
    req: &AiRequest,
    emit: &mut (dyn FnMut(StreamEvent) + Send),
) -> Result<(), AiError> {
    let mut builder = client
        .post(join_path(&cfg.base_url, "chat/completions"))
        .header(ACCEPT, "text/event-stream")
        .json(&build_body(&cfg.model, req));
    if let Some(key) = &cfg.api_key {
        builder = builder.bearer_auth(key);
    }
    let resp = builder.send().await.map_err(|e| AiError::from_reqwest(&e))?;
    let status = resp.status();
    if !status.is_success() {
        let body = error_body(resp).await;
        return Err(AiError::from_status(status.as_u16(), &body));
    }
    let is_json = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.contains("application/json"));
    if is_json {
        let body = resp.text().await.map_err(|e| AiError::from_reqwest(&e))?;
        emit(StreamEvent::Delta { text: parse_full(&body)? });
        return Ok(());
    }
    pump_sse(resp, |ev| parse_event(&ev.data), emit).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::ChatMessage;

    #[test]
    fn body_puts_system_first() {
        let req = AiRequest {
            system: "be brief".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
        };
        let body = build_body("gpt-x", &req);
        assert_eq!(body["model"], "gpt-x");
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], "hi");
    }

    #[test]
    fn parses_stream_events() {
        let delta = r#"{"id":"x","choices":[{"index":0,"delta":{"content":"Hel"}}]}"#;
        assert_eq!(parse_event(delta).unwrap(), Parsed::Text("Hel".into()));
        let role_only = r#"{"choices":[{"index":0,"delta":{"role":"assistant"}}]}"#;
        assert_eq!(parse_event(role_only).unwrap(), Parsed::Text(String::new()));
        assert_eq!(parse_event("[DONE]").unwrap(), Parsed::Done);
        assert!(parse_event(r#"{"error":{"message":"boom"}}"#).is_err());
        assert_eq!(parse_event("{nope").unwrap_err().kind, ErrorKind::BadResponse);
    }

    #[test]
    fn parses_non_streamed_response() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Hola"}}]}"#;
        assert_eq!(parse_full(body).unwrap(), "Hola");
        assert!(parse_full("{}").is_err());
    }
}
