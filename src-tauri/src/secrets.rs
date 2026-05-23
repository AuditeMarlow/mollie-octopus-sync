use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Credentials {
    pub mollie_api_key: Option<String>,
    pub emailoctopus_api_key: Option<String>,
}

// Storage strategy:
//
// - **Windows** (production target) uses Credential Manager via the `keyring`
//   crate. That's the secure path and the one the spec requires.
// - **macOS / Linux** (dev environments) fall back to a 0600-permission JSON
//   file under the app's data dir. Keyring works on those platforms too, but
//   macOS Keychain ACLs are tied to the binary's code signature — every
//   `tauri dev` rebuild changes the signature and locks us out of the entry
//   we wrote in the previous run, which is hostile to development. The file
//   fallback is "secure enough" for dev secrets: restrictive perms, inside the
//   user's profile, never world-readable.

pub fn load() -> Result<Credentials, String> {
    backend::load()
}

pub fn store(creds: &Credentials) -> Result<(), String> {
    backend::store(creds)
}

pub fn clear() -> Result<(), String> {
    backend::clear()
}

// Partial-update merge: a None field in `patch` leaves `current` alone.
// Shared so both backends apply identical semantics to the IPC payload.
fn apply_patch(current: &mut Credentials, patch: &Credentials) {
    if patch.mollie_api_key.is_some() {
        current.mollie_api_key = patch.mollie_api_key.clone();
    }
    if patch.emailoctopus_api_key.is_some() {
        current.emailoctopus_api_key = patch.emailoctopus_api_key.clone();
    }
}

#[cfg(target_os = "windows")]
mod backend {
    use super::Credentials;
    use keyring::Entry;

    const SERVICE: &str = "mollie-octopus-sync";
    const ACCOUNT_MOLLIE: &str = "mollie_api_key";
    const ACCOUNT_EO: &str = "emailoctopus_api_key";

    fn entry(account: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, account).map_err(|e| format!("keyring entry: {e}"))
    }

    pub fn load() -> Result<Credentials, String> {
        Ok(Credentials {
            mollie_api_key: read(ACCOUNT_MOLLIE)?,
            emailoctopus_api_key: read(ACCOUNT_EO)?,
        })
    }

    pub fn store(creds: &Credentials) -> Result<(), String> {
        if let Some(k) = &creds.mollie_api_key {
            write(ACCOUNT_MOLLIE, k)?;
        }
        if let Some(k) = &creds.emailoctopus_api_key {
            write(ACCOUNT_EO, k)?;
        }
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        delete(ACCOUNT_MOLLIE)?;
        delete(ACCOUNT_EO)?;
        Ok(())
    }

    fn read(account: &str) -> Result<Option<String>, String> {
        match entry(account)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keyring read {account}: {e}")),
        }
    }

    fn write(account: &str, value: &str) -> Result<(), String> {
        entry(account)?
            .set_password(value)
            .map_err(|e| format!("keyring write {account}: {e}"))
    }

    fn delete(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keyring delete {account}: {e}")),
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod backend {
    use super::Credentials;
    use std::fs;
    use std::path::PathBuf;

    const FILE_NAME: &str = "credentials.json";

    fn path() -> Result<PathBuf, String> {
        Ok(crate::config::app_data_dir()?.join(FILE_NAME))
    }

    pub fn load() -> Result<Credentials, String> {
        let p = path()?;
        if !p.exists() {
            return Ok(Credentials::default());
        }
        let raw = fs::read_to_string(&p).map_err(|e| format!("read {p:?}: {e}"))?;
        serde_json::from_str(&raw).map_err(|e| format!("parse credentials: {e}"))
    }

    pub fn store(patch: &Credentials) -> Result<(), String> {
        let p = path()?;
        // Without merging, sending `{ mollie: null, eo: "new" }` from the
        // renderer would clobber the existing Mollie key. The Windows keyring
        // backend already has this behaviour structurally.
        let mut current = load_existing(&p);
        super::apply_patch(&mut current, patch);
        let raw = serde_json::to_string(&current)
            .map_err(|e| format!("serialize credentials: {e}"))?;
        write_atomic_restricted(&p, raw.as_bytes())
    }

    fn load_existing(p: &std::path::Path) -> Credentials {
        if !p.exists() {
            return Credentials::default();
        }
        fs::read_to_string(p)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn clear() -> Result<(), String> {
        let p = path()?;
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("remove {p:?}: {e}"))?;
        }
        Ok(())
    }

    // Create the temp file with 0o600 from the start (no chmod-after-write
    // TOCTOU window), write, fsync, then atomically rename over the target.
    #[cfg(unix)]
    fn write_atomic_restricted(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let tmp = path.with_extension("json.tmp");
        {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&tmp)
                .map_err(|e| format!("open {tmp:?}: {e}"))?;
            f.write_all(bytes)
                .map_err(|e| format!("write credentials: {e}"))?;
            // Best-effort fsync. If the kernel doesn't flush before a crash
            // we'd rather lose the new content than have a half-written file
            // survive the rename.
            f.sync_all().ok();
        }
        fs::rename(&tmp, path)
            .map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))
    }

    // Non-unix non-windows fallback (e.g. wasm targets). No perms model to
    // enforce — just write through.
    #[cfg(not(unix))]
    fn write_atomic_restricted(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
        crate::config::write_atomic(path, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_round_trip_full() {
        let c = Credentials {
            mollie_api_key: Some("live_abc".into()),
            emailoctopus_api_key: Some("eo_xyz".into()),
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let back: Credentials = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.mollie_api_key.as_deref(), Some("live_abc"));
        assert_eq!(back.emailoctopus_api_key.as_deref(), Some("eo_xyz"));
    }

    #[test]
    fn credentials_round_trip_partial() {
        // After a partial setup or a clear() on one key, the struct must still
        // serialize cleanly with one half None.
        let c = Credentials {
            mollie_api_key: Some("live_abc".into()),
            emailoctopus_api_key: None,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        let back: Credentials = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.mollie_api_key.as_deref(), Some("live_abc"));
        assert!(back.emailoctopus_api_key.is_none());
    }

    #[test]
    fn default_credentials_have_no_keys() {
        let c = Credentials::default();
        assert!(c.mollie_api_key.is_none());
        assert!(c.emailoctopus_api_key.is_none());
    }

    #[test]
    fn apply_patch_only_overwrites_some_fields() {
        let mut current = Credentials {
            mollie_api_key: Some("live_old".into()),
            emailoctopus_api_key: Some("eo_old".into()),
        };
        let patch = Credentials {
            mollie_api_key: None,
            emailoctopus_api_key: Some("eo_new".into()),
        };
        apply_patch(&mut current, &patch);
        assert_eq!(current.mollie_api_key.as_deref(), Some("live_old"));
        assert_eq!(current.emailoctopus_api_key.as_deref(), Some("eo_new"));
    }

    #[test]
    fn apply_patch_is_noop_when_both_fields_are_none() {
        let mut current = Credentials {
            mollie_api_key: Some("live_old".into()),
            emailoctopus_api_key: Some("eo_old".into()),
        };
        apply_patch(&mut current, &Credentials::default());
        assert_eq!(current.mollie_api_key.as_deref(), Some("live_old"));
        assert_eq!(current.emailoctopus_api_key.as_deref(), Some("eo_old"));
    }

    #[test]
    fn apply_patch_populates_from_empty() {
        let mut current = Credentials::default();
        let patch = Credentials {
            mollie_api_key: Some("live_new".into()),
            emailoctopus_api_key: Some("eo_new".into()),
        };
        apply_patch(&mut current, &patch);
        assert_eq!(current.mollie_api_key.as_deref(), Some("live_new"));
        assert_eq!(current.emailoctopus_api_key.as_deref(), Some("eo_new"));
    }
}
