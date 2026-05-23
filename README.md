# Mollie &rarr; EmailOctopus Sync

A lightweight Windows desktop app that pulls Mollie payment customers and
upserts them as contacts into an EmailOctopus list. Built for Peggy Pay
merchants (whose payments are processed through Mollie under the hood), but
works for any Mollie account.

- **No backend.** Everything runs on the user's machine.
- **Safe to run from multiple machines.** Idempotency is anchored in
  EmailOctopus (upsert by email), not in local files — so syncing from
  laptop A and laptop B never produces duplicates.
- **API keys in Windows Credential Manager.** Never in plaintext on disk on
  the production target. (Dev builds on macOS / Linux fall back to a
  `0600` JSON file — see [Security model](#security-model).)

## Stack

- Tauri 2 (Rust shell, Windows MSI + NSIS bundles)
- React 18 + TypeScript + Vite
- `keyring` crate for OS-native credential storage (Windows)
- `tauri-plugin-http` for outbound API calls from the renderer
- `tauri-plugin-updater` (minisign-signed update bundles)
- `tauri-plugin-single-instance` (one app process at a time, avoids
  credential-file races)
- `tauri-plugin-autostart` (optional "start at login")

## How it works

```
+--------+        +--------------+        +-----------------+
| Mollie | -----> | Sync engine  | -----> | EmailOctopus v2 |
| /v2/   |  pull  | (TypeScript) |  PUT   | /lists/{}/      |
| payments|       |              |  upsert| contacts        |
+--------+        +--------------+        +-----------------+
```

1. Pull every Mollie payment, paginated via Mollie's cursor (all statuses —
   open, paid, failed, etc. — since the goal is to capture every customer who
   ever started a checkout, not just those who completed one).
2. Fall back to `/v2/customers/{id}` when a payment has no `billingEmail`.
3. Normalize: lowercase + trim emails, split full names, take the most recent
   payment per email.
4. `PUT /lists/{id}/contacts` (EmailOctopus v2 upsert) for each unique email.
   The endpoint creates if missing and updates if existing — that's where the
   cross-machine idempotency comes from.

## Security model

- **At rest.** Windows production builds put API keys in Credential Manager
  (service `mollie-octopus-sync`) via the `keyring` crate. macOS / Linux dev
  builds use a `0600` JSON file at `<app data dir>/credentials.json`. The
  file is written atomically (tmp file created with mode `0600`, then
  renamed) — no window in which it exists with default permissions.
- **In memory.** The renderer learns only whether credentials exist at
  startup; the actual keys are pulled just-in-time inside `useSync.start()`
  and fall out of scope when the sync returns. Settings doesn't pre-fill
  password fields, so the saved keys are never in the DOM. Residual
  exposure: keys still cross the IPC bridge inside `Authorization` headers
  during an active sync.
- **Outbound network.** The Tauri capability allowlist restricts HTTP to
  `api.mollie.com` and `api.emailoctopus.com`. The renderer cannot reach
  any other host.
- **Updates.** `tauri-plugin-updater` verifies a minisign signature against
  the pubkey baked into the app binary before installing. The private key
  lives only in this repo's GitHub Actions secrets — anyone trying to ship
  a tampered `.exe` to your install dir also needs that key.
- **Single instance.** A second launch focuses the running window instead
  of spawning a parallel process. Avoids two processes racing on
  `credentials.json` / `config.json`.
- **Logs.** Daily log files at `%APPDATA%\mollie-octopus-sync\logs\` are
  sanitized: control characters (including `\n` / `\r`) in payment metadata
  and upstream error bodies are stripped before being written, so
  attacker-controlled fields can't forge log lines. Line length is capped.

## Prerequisites

- **Node.js** &ge; 22
- **Rust** stable (`rustup default stable`)
- Windows target (for production builds): WebView2 runtime is shipped with
  Windows 11; Windows 10 may need the bootstrapper. See
  [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows).

## Install

```sh
git clone <this-repo>
cd mollie-octopus-sync
npm install   # also installs Husky's commit-msg hook
```

After install, any commit whose message isn't a valid
[Conventional Commit](https://www.conventionalcommits.org/) (`feat: ...`,
`fix(scope): ...`, `chore!: ...`, etc.) will be rejected locally. PR titles
get the same check in CI.

A Tauri icon set is already committed under `src-tauri/icons/`. Only
regenerate it if you're rebranding:

```sh
npm run tauri -- icon path/to/source-1024.png
```

## Run the app in dev

```sh
npm run tauri:dev
```

Vite serves the React shell on `localhost:1420` and Tauri opens a native
window pointing at it. Hot reload works for the frontend; Rust changes
trigger a rebuild.

## Build a Windows installer

```sh
npm run tauri:build
```

Outputs under `src-tauri/target/release/bundle/`:

- `msi/Mollie to EmailOctopus Sync_0.1.0_x64_en-US.msi` (per-machine MSI)
- `nsis/Mollie to EmailOctopus Sync_0.1.0_x64-setup.exe` (per-user NSIS)

Both create a desktop shortcut. SmartScreen will warn on first install
until the app is code-signed with an OV/EV cert.

## First-run wizard

1. Paste Mollie API key (`live_xxx` or `test_xxx` — get it from Peggy Pay
   _Bedrijfsprofiel &rarr; Betaalinstellingen_, or directly from your Mollie
   dashboard).
2. Paste EmailOctopus API key (Account &rarr; Integrations & API).
3. Pick an existing EmailOctopus list, or type a name to create one.

Keys are stored:

- **Windows** (production): **Credential Manager**, service name
  `mollie-octopus-sync`. Remove via Settings → "Clear & reset", or delete the
  entries from Credential Manager directly.
- **macOS / Linux** (dev): JSON file at
  `<app data dir>/credentials.json` with permissions `0600`. The reason we
  don't use Keychain/Secret Service on these platforms is that macOS Keychain
  ACLs are bound to the binary's code signature, and every `tauri dev`
  rebuild produces a new signature — which locks the new binary out of
  entries the previous one wrote. The file fallback is dev-grade, not
  intended for distributing the app outside Windows.

## Sync behaviour

Clicking **Sync Contacts** triggers:

| Phase     | Action                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Fetching  | Pages through `/v2/payments` (every status).                                                                   |
| Normalize | Resolves customer record for payments lacking `billingEmail`. Splits full name. Latest payment wins per email. |
| Syncing   | `PUT /lists/{id}/contacts` per unique email. Tags each contact `mollie-import`.                                |

Tick **Dry run** to walk the whole pipeline without writing to EmailOctopus.

Because dedup happens entirely in EmailOctopus (upsert by email) and the
app keeps no local "already synced" cache, running the sync from a second
machine just re-upserts the same contacts — a no-op for unchanged data.

## File layout

```
mollie-octopus-sync/
├── src/                 React UI + TypeScript domain code
│   ├── api/             Mollie + EmailOctopus HTTP clients
│   ├── sync/            Normalization + the sync orchestrator
│   ├── lib/             Tauri command wrappers
│   └── components/      React views (wizard, main, settings, progress)
├── src-tauri/           Rust shell
│   ├── src/
│   │   ├── lib.rs       Tauri builder + plugin wiring
│   │   ├── commands.rs  Invokable commands exposed to JS
│   │   ├── secrets.rs   API key storage: keyring (Win) / 0o600 file (dev)
│   │   ├── config.rs    Non-secret JSON config in %APPDATA%
│   │   └── logger.rs    Daily rolling logs in %APPDATA%\\logs (sanitized)
│   ├── capabilities/    Tauri 2 permission scopes
│   └── tauri.conf.json  Bundle + window config
└── package.json
```

## Files written by the app at runtime (Windows)

- `%APPDATA%\mollie-octopus-sync\config.json` &mdash; selected list, last sync
  timestamp, last summary. **No secrets.**
- `%APPDATA%\mollie-octopus-sync\logs\sync-YYYY-MM-DD.log` &mdash; rolling
  daily log files. Open from Settings &rarr; "Open logs folder".
- Windows Credential Manager entries for the two API keys.
- On macOS / Linux dev builds: `<app data dir>/credentials.json` (`0600`) in
  place of the Credential Manager entries.

## Troubleshooting

- **"keyring entry"** errors on first run usually mean Credential Manager
  is locked or the user account isn't a normal local profile. The app falls
  back to surfacing the error in the UI rather than persisting plaintext.
- **`401`/`403` from Mollie** &mdash; the key may be revoked or for the wrong
  organization. Use _Test connection_ in Settings to verify.
- **`429` from EmailOctopus** &mdash; we auto-retry up to three times with
  short backoff (their bucket refills at 10 tokens/sec). A burst of failures
  here is fine; a sustained one means you have more contacts than the bucket
  can serve at once and the next sync will pick up where this one left off.

## Release pipeline

Push a `feat:` / `fix:` / breaking commit to `main` →
[knope](https://knope.tech) bumps the three version files in lockstep
(`package.json`, `Cargo.toml`, `tauri.conf.json`), prepends a CHANGELOG
entry, tags, and creates the GitHub release → `build.yml` picks up the
release, builds and signs the `.msi` + `.exe`, and uploads them with
`latest.json` so running apps see the update on their next check.

### Updater signing keys

The auto-updater verifies update bundles against the minisign pubkey
baked into the app at compile time. **A pubkey is already shipped in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).** Don't replace it
unless you intentionally rotate the key — running apps with the previous
pubkey will reject updates signed by the new private key.

For the build pipeline to actually sign releases, two GitHub Actions
secrets must be set on the repo:

| Secret                               | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Contents of the private `.key` file         |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password set during `tauri signer generate` |

Without these the build still succeeds, but `latest.json` won't pass the
signature check — installed apps will silently refuse updates. Treat the
private key like a code-signing cert: anyone with it can publish an
"update" your installed apps will accept.

## License

[MIT](LICENSE). Copyright © 2026 AuditeMarlow.
