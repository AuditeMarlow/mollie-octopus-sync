use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppConfig {
    pub emailoctopus_list_id: Option<String>,
    pub emailoctopus_list_name: Option<String>,
    pub mollie_mode: Option<String>, // "live" | "test", derived from the active key prefix
    pub last_sync_at: Option<String>,
    pub last_sync_summary: Option<SyncSummary>,
    /// Minutes between automatic background syncs. `None` or `Some(0)` disables.
    pub sync_interval_minutes: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct SyncSummary {
    pub added: u32,
    pub updated: u32,
    pub skipped: u32,
    pub failed: u32,
}

pub fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "no data dir".to_string())?;
    let dir = base.join("mollie-octopus-sync");
    fs::create_dir_all(&dir).map_err(|e| format!("create {dir:?}: {e}"))?;
    restrict_dir_perms(&dir);
    Ok(dir)
}

// Best-effort tightening to 0o700. The file mode on credentials.json is the
// real protection; this just stops a curious neighbour from listing the dir.
#[cfg(unix)]
fn restrict_dir_perms(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.mode() & 0o777 != 0o700 {
            perms.set_mode(0o700);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

#[cfg(not(unix))]
fn restrict_dir_perms(_path: &std::path::Path) {}

fn config_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("config.json"))
}

pub fn load() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read {path:?}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse config: {e}"))
}

pub fn save(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize config: {e}"))?;
    write_atomic(&path, raw.as_bytes())
}

// Write to a sibling tmp file then rename. A crash mid-write leaves the
// previous file intact instead of truncated-and-half-written.
pub(crate) fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("write {tmp:?}: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_round_trips() {
        let cfg = AppConfig::default();
        let json = serde_json::to_string(&cfg).expect("serialize");
        let back: AppConfig = serde_json::from_str(&json).expect("deserialize");
        assert!(back.emailoctopus_list_id.is_none());
        assert!(back.emailoctopus_list_name.is_none());
        assert!(back.mollie_mode.is_none());
        assert!(back.last_sync_at.is_none());
        assert!(back.last_sync_summary.is_none());
        assert!(back.sync_interval_minutes.is_none());
    }

    #[test]
    fn populated_config_round_trips() {
        let cfg = AppConfig {
            emailoctopus_list_id: Some("list_x".into()),
            emailoctopus_list_name: Some("Test list".into()),
            mollie_mode: Some("live".into()),
            last_sync_at: Some("2025-05-23T12:00:00Z".into()),
            last_sync_summary: Some(SyncSummary {
                added: 3,
                updated: 1,
                skipped: 2,
                failed: 0,
            }),
            sync_interval_minutes: Some(30),
        };
        let json = serde_json::to_string(&cfg).expect("serialize");
        let back: AppConfig = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.emailoctopus_list_id.as_deref(), Some("list_x"));
        assert_eq!(back.sync_interval_minutes, Some(30));
        assert_eq!(back.last_sync_summary.as_ref().map(|s| s.added), Some(3));
    }

    #[test]
    fn deserializes_old_config_missing_sync_interval() {
        // A config file written before `sync_interval_minutes` was added must
        // still load cleanly with that field defaulting to None.
        let json = r#"{
            "emailoctopus_list_id": "list_x",
            "emailoctopus_list_name": "My list",
            "mollie_mode": "test",
            "last_sync_at": null,
            "last_sync_summary": null
        }"#;
        let cfg: AppConfig = serde_json::from_str(json).expect("deserialize");
        assert_eq!(cfg.emailoctopus_list_id.as_deref(), Some("list_x"));
        assert!(cfg.sync_interval_minutes.is_none());
    }

    #[test]
    fn sync_summary_counts_round_trip() {
        let s = SyncSummary {
            added: 12,
            updated: 4,
            skipped: 28,
            failed: 1,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        let back: SyncSummary = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.added, 12);
        assert_eq!(back.updated, 4);
        assert_eq!(back.skipped, 28);
        assert_eq!(back.failed, 1);
    }
}
