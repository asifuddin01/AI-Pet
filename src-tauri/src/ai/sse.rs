//! Minimal Server-Sent Events parser (enough for OpenAI and Anthropic streams).

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    /// Feed raw bytes; returns every event completed by this chunk.
    /// Splitting on `\n` is UTF-8 safe because it never appears inside a multi-byte char.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        let mut start = 0;
        while let Some(rel) = self.buf[start..].iter().position(|&b| b == b'\n') {
            let end = start + rel;
            let mut line = &self.buf[start..end];
            if line.last() == Some(&b'\r') {
                line = &line[..line.len() - 1];
            }
            let line = String::from_utf8_lossy(line).into_owned();
            self.line(&line, &mut out);
            start = end + 1;
        }
        self.buf.drain(..start);
        out
    }

    /// Flush a trailing event that wasn't followed by a blank line.
    pub fn finish(&mut self) -> Vec<SseEvent> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let rest = std::mem::take(&mut self.buf);
            let line = String::from_utf8_lossy(&rest).trim_end_matches('\r').to_string();
            self.line(&line, &mut out);
        }
        self.line("", &mut out);
        out
    }

    fn line(&mut self, line: &str, out: &mut Vec<SseEvent>) {
        if line.is_empty() {
            if !self.data.is_empty() || self.event.is_some() {
                out.push(SseEvent {
                    event: self.event.take(),
                    data: std::mem::take(&mut self.data).join("\n"),
                });
            }
            return;
        }
        if line.starts_with(':') {
            return; // comment / keep-alive
        }
        let (field, value) = match line.find(':') {
            Some(i) => {
                let v = &line[i + 1..];
                (&line[..i], v.strip_prefix(' ').unwrap_or(v))
            }
            None => (line, ""),
        };
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_across_chunk_boundaries() {
        let mut p = SseParser::default();
        assert!(p.push(b"event: message_start\nda").is_empty());
        let evs = p.push(b"ta: {\"a\":1}\n\ndata: second\r\n\r\n");
        assert_eq!(
            evs,
            vec![
                SseEvent { event: Some("message_start".into()), data: "{\"a\":1}".into() },
                SseEvent { event: None, data: "second".into() },
            ]
        );
    }

    #[test]
    fn keeps_multibyte_characters_split_across_chunks() {
        let mut p = SseParser::default();
        let bytes = "data: আমি\n\n".as_bytes();
        let (a, b) = bytes.split_at(8); // splits inside a Bengali character
        assert!(p.push(a).is_empty());
        assert_eq!(p.push(b)[0].data, "আমি");
    }

    #[test]
    fn ignores_comments_and_joins_multiline_data() {
        let mut p = SseParser::default();
        let evs = p.push(b": ping\ndata: a\ndata: b\n\n");
        assert_eq!(evs, vec![SseEvent { event: None, data: "a\nb".into() }]);
    }

    #[test]
    fn finish_flushes_unterminated_event() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: [DONE]").is_empty());
        assert_eq!(p.finish(), vec![SseEvent { event: None, data: "[DONE]".into() }]);
    }
}
