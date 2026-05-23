use chrono::Local;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use crate::config::app_data_dir;

const MAX_MESSAGE_LEN: usize = 4096;
const MAX_LEVEL_LEN: usize = 16;

pub fn logs_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| format!("create logs dir: {e}"))?;
    Ok(dir)
}

pub fn append(level: &str, message: &str) -> Result<(), String> {
    // Mollie payment metadata and upstream API error bodies feed into log
    // messages, so a stray newline would let an attacker forge log entries.
    let safe_level = sanitize(level, MAX_LEVEL_LEN);
    let safe_message = sanitize(message, MAX_MESSAGE_LEN);
    let now = Local::now();
    let file = logs_dir()?.join(format!("sync-{}.log", now.format("%Y-%m-%d")));
    let line = format!("{} [{}] {}\n", now.to_rfc3339(), safe_level, safe_message);
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| format!("open {file:?}: {e}"))?;
    f.write_all(line.as_bytes())
        .map_err(|e| format!("write log: {e}"))
}

fn sanitize(s: &str, max_chars: usize) -> String {
    s.chars()
        .filter(|c| *c == '\t' || !c.is_control())
        .take(max_chars)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn strips_newlines_and_carriage_returns() {
        assert_eq!(
            sanitize("evil\n2025-01-01 [info] forged", 1024),
            "evil2025-01-01 [info] forged",
        );
        assert_eq!(sanitize("a\rb", 1024), "ab");
    }

    #[test]
    fn keeps_tabs_but_drops_other_control_chars() {
        assert_eq!(sanitize("a\tb\u{0007}c\u{0000}d", 1024), "a\tbcd");
    }

    #[test]
    fn truncates_to_max_chars() {
        let long = "x".repeat(10_000);
        assert_eq!(sanitize(&long, 16).len(), 16);
    }
}
