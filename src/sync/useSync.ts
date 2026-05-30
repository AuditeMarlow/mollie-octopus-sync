import { useCallback, useEffect, useRef, useState } from "react";
import { runSync } from "./engine";
import { getCredentials, saveConfig } from "../lib/tauri";
import type { AppConfig, SyncProgress } from "../types";

export interface StartOptions {
  /** When true, missing credentials / list don't surface as a UI error. */
  silent?: boolean;
  /** When true, the sync runs through the pipeline without writing to EO. */
  dryRun?: boolean;
}

export interface UseSync {
  running: boolean;
  progress: SyncProgress | null;
  error: string | null;
  start: (opts?: StartOptions) => Promise<void>;
  cancel: () => void;
  clearError: () => void;
}

export function useSync(
  config: AppConfig,
  hasCredentials: boolean,
  onConfigChange: (cfg: AppConfig) => void,
): UseSync {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  // Latest config/hasCredentials live in refs so the `start` callback stays
  // stable. Otherwise every config save would re-create `start`, which would
  // tear down the periodic timer in App.tsx that depends on it. The sync
  // happens in an effect rather than inline so we don't write to refs during
  // render — that's what react-hooks/refs flags (assignments-during-render
  // can run multiple times under concurrent rendering and surprise readers).
  const cfgRef = useRef(config);
  const hasCredsRef = useRef(hasCredentials);
  const onCfgRef = useRef(onConfigChange);
  useEffect(() => {
    cfgRef.current = config;
    hasCredsRef.current = hasCredentials;
    onCfgRef.current = onConfigChange;
  }, [config, hasCredentials, onConfigChange]);

  const start = useCallback(async (opts?: StartOptions) => {
    if (runningRef.current) return;
    const cfg = cfgRef.current;
    if (!cfg.emailoctopus_list_id) {
      if (!opts?.silent) setError("No EmailOctopus list selected.");
      return;
    }
    if (!hasCredsRef.current) {
      // The renderer's local hasCredentials boolean is false. Either setup
      // never completed, or App.tsx never received the value from
      // hasCredentialsIpc() at boot.
      if (!opts?.silent)
        setError("Setup hasn't completed — API keys aren't registered yet.");
      return;
    }
    // Pull credentials just-in-time from the OS keyring / file backend, scoped
    // to this function so they fall out of scope (and become GC-eligible) as
    // soon as the sync finishes. Keeping them out of long-lived component
    // state shrinks the in-memory exposure window from the app's lifetime to
    // the duration of one sync.
    const creds = await getCredentials();
    if (!creds.mollie_api_key || !creds.emailoctopus_api_key) {
      // get_credentials succeeded but the OS credential store gave us empty
      // values back. Indicates a storage issue (e.g. on Windows, the keyring
      // crate built without `windows-native` silently no-ops every write).
      if (!opts?.silent)
        setError(
          "Couldn't read API keys from the OS credential store. Re-run setup, " +
            "and if it persists, check Credential Manager (Windows) or the " +
            "credentials.json file (macOS/Linux dev) for entries under " +
            "'mollie-octopus-sync'.",
        );
      return;
    }
    setError(null);
    setRunning(true);
    runningRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await runSync({
        mollie: { apiKey: creds.mollie_api_key },
        emailoctopus: { apiKey: creds.emailoctopus_api_key },
        listId: cfg.emailoctopus_list_id,
        tag: "mollie-import",
        dryRun: opts?.dryRun ?? false,
        signal: ctrl.signal,
        onProgress: (p) => setProgress({ ...p }),
      });
      const next: AppConfig = {
        ...cfg,
        last_sync_at: result.finishedAt,
        last_sync_summary: result.summary,
      };
      await saveConfig(next);
      onCfgRef.current(next);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setError("Sync cancelled.");
      } else {
        setError(formatError(e));
      }
    } finally {
      setRunning(false);
      runningRef.current = false;
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { running, progress, error, start, cancel, clearError };
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
