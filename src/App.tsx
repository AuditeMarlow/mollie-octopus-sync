import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { MainView } from "./components/MainView";
import { SettingsView } from "./components/SettingsView";
import { SetupWizard } from "./components/SetupWizard";
import { Spinner } from "./components/Spinner";
import { UpdateBanner } from "./components/UpdateBanner";
import { hasCredentials as hasCredentialsIpc, loadConfig } from "./lib/tauri";
import { checkForUpdate, type AvailableUpdate } from "./lib/updater";
import { useSync } from "./sync/useSync";
import type { AppConfig } from "./types";
import { DEFAULT_SYNC_INTERVAL_MINUTES } from "./types";
import "./App.css";

// Re-check for app updates every 6 hours while the app is running.
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

type Screen = "loading" | "setup" | "main" | "settings";

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [config, setConfig] = useState<AppConfig | null>(null);
  // We deliberately don't hold the credentials in renderer state. They live
  // in the OS keyring / 0o600 file and are pulled just-in-time by useSync /
  // SettingsView. This boolean is all the renderer needs to drive screen
  // selection and the periodic sync gate.
  const [hasCredentials, setHasCredentials] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] =
    useState<AvailableUpdate | null>(null);
  // Read the version from tauri.conf.json at runtime rather than hard-coding
  // it. Avoids the subtitle drifting from the actually-installed build, which
  // is how it ended up reading "v0.1" on every release before v0.0.6.
  const [appVersion, setAppVersion] = useState<string>("");
  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, hasCreds] = await Promise.all([
          loadConfig(),
          hasCredentialsIpc(),
        ]);
        // Default the sync interval the first time we load a pre-existing
        // config that predates this field.
        if (cfg.sync_interval_minutes === undefined) {
          cfg.sync_interval_minutes = DEFAULT_SYNC_INTERVAL_MINUTES;
        }
        setConfig(cfg);
        setHasCredentials(hasCreds);
        const configured = hasCreds && !!cfg.emailoctopus_list_id;
        setScreen(configured ? "main" : "setup");
      } catch (e) {
        setBootError(String(e));
        setScreen("setup");
      }
    })();
  }, []);

  // useSync needs a non-null config. When we're in `loading` or `setup` it's
  // null — we render a placeholder for the hook (it won't run any sync
  // because there's no list/credentials anyway).
  const sync = useSync(config ?? EMPTY_CONFIG, hasCredentials, setConfig);

  // Periodic auto-sync. Re-arms whenever the interval changes; cleans up
  // when the component unmounts (i.e. app quits).
  useEffect(() => {
    const minutes = config?.sync_interval_minutes;
    if (!minutes || minutes <= 0) return;
    if (!config?.emailoctopus_list_id) return;
    if (!hasCredentials) return;
    const id = window.setInterval(
      () => {
        if (!sync.running) void sync.start({ silent: true });
      },
      minutes * 60 * 1000,
    );
    return () => window.clearInterval(id);
  }, [
    config?.sync_interval_minutes,
    config?.emailoctopus_list_id,
    hasCredentials,
    sync,
  ]);

  // Tray "Sync now" menu item emits this event.
  useEffect(() => {
    const p = listen("tray://sync-now", () => {
      if (!sync.running) void sync.start();
    });
    return () => {
      p.then((unlisten) => unlisten());
    };
  }, [sync]);

  // Check for app updates on startup, then re-check on an interval. Errors
  // are swallowed silently — a transient network failure shouldn't surface
  // as a banner.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      checkForUpdate()
        .then((u) => {
          if (!cancelled && u) setAvailableUpdate(u);
        })
        .catch(() => {});
    };
    probe();
    const timer = window.setInterval(probe, UPDATE_RECHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (screen === "loading") {
    return (
      <div className="app">
        <Spinner /> Loading…
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Mollie &rarr; EmailOctopus Sync</h1>
        <span className="app__subtitle">{appVersion && `v${appVersion}`}</span>
      </header>

      {bootError && (
        <div className="notice notice--error">Startup error: {bootError}</div>
      )}

      {availableUpdate && (
        <UpdateBanner
          update={availableUpdate}
          onDismiss={() => setAvailableUpdate(null)}
        />
      )}

      <div className="app__body">
        {screen === "setup" && (
          <SetupWizard
            onComplete={(cfg) => {
              setConfig(cfg);
              setHasCredentials(true);
              setScreen("main");
            }}
          />
        )}

        {screen === "main" && config && (
          <MainView
            config={config}
            hasCredentials={hasCredentials}
            sync={sync}
            onOpenSettings={() => setScreen("settings")}
          />
        )}

        {screen === "settings" && config && (
          <SettingsView
            config={config}
            onSaved={(cfg) => {
              setConfig(cfg);
              setScreen("main");
            }}
            onReset={() => {
              setConfig({
                emailoctopus_list_id: null,
                emailoctopus_list_name: null,
                mollie_mode: null,
                last_sync_at: null,
                last_sync_summary: null,
                sync_interval_minutes: DEFAULT_SYNC_INTERVAL_MINUTES,
              });
              setHasCredentials(false);
              setScreen("setup");
            }}
            onClose={() => setScreen("main")}
            onUpdateFound={setAvailableUpdate}
          />
        )}
      </div>
    </div>
  );
}

const EMPTY_CONFIG: AppConfig = {
  emailoctopus_list_id: null,
  emailoctopus_list_name: null,
  mollie_mode: null,
  last_sync_at: null,
  last_sync_summary: null,
  sync_interval_minutes: null,
};
