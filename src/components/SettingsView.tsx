import { useEffect, useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { ping as molliePing, detectMode } from "../api/mollie";
import {
  createList,
  listLists,
  ping as eoPing,
  type EOList,
} from "../api/emailoctopus";
import {
  clearCredentials,
  disableAutostart,
  enableAutostart,
  getCredentials,
  isAutostartEnabled,
  openLogsFolder,
  saveConfig,
  setCredentials,
} from "../lib/tauri";
import { checkForUpdate, type AvailableUpdate } from "../lib/updater";
import type { AppConfig, Credentials } from "../types";
import { SYNC_INTERVAL_CHOICES } from "../types";

interface Props {
  config: AppConfig;
  onSaved: (config: AppConfig) => void;
  onReset: () => void;
  onClose: () => void;
  // Called when the manual update check finds a pending update, so the
  // top-level UpdateBanner state can pick it up and render once the user
  // navigates back out of Settings.
  onUpdateFound: (update: AvailableUpdate) => void;
}

// Password fields start blank, with a placeholder telling the user a key is
// already saved. Typing into a field is the only way to *change* a key; an
// empty field on save means "leave it alone". This keeps the saved keys out
// of React state and out of the DOM `value` attribute.
export function SettingsView({
  config,
  onSaved,
  onReset,
  onClose,
  onUpdateFound,
}: Props) {
  const [mollieKey, setMollieKey] = useState("");
  const [eoKey, setEoKey] = useState("");
  const [lists, setLists] = useState<EOList[]>([]);
  const [listId, setListId] = useState(config.emailoctopus_list_id ?? "");
  const [newListName, setNewListName] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number | null>(
    config.sync_interval_minutes ?? null,
  );
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);

  useEffect(() => {
    isAutostartEnabled().then(setAutostart);
  }, []);

  useEffect(() => {
    // Populate the list dropdown using the typed EO key if present, otherwise
    // briefly load the saved one. The key only lives as a local `apiKey` here;
    // it's not stored in component state. setLoadingLists fires from inside
    // the async IIFE rather than at the top of the effect body so that
    // react-hooks/set-state-in-effect doesn't flag it as cascading renders.
    let cancelled = false;
    (async () => {
      setLoadingLists(true);
      try {
        const apiKey =
          eoKey || (await getCredentials()).emailoctopus_api_key || "";
        if (!apiKey) {
          if (!cancelled) setLists([]);
          return;
        }
        const ls = await listLists({ apiKey });
        if (!cancelled) setLists(ls);
      } catch (e) {
        if (!cancelled) setError(formatError(e));
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eoKey]);

  async function testConnections() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      // Tests whatever would actually take effect: typed key if present,
      // saved key otherwise. The saved key is only loaded for the duration
      // of these two calls.
      const saved = mollieKey && eoKey ? null : await getCredentials();
      const mollieToTest = mollieKey || saved?.mollie_api_key || "";
      const eoToTest = eoKey || saved?.emailoctopus_api_key || "";
      if (!mollieToTest || !eoToTest) {
        setError("Missing API keys to test.");
        return;
      }
      await molliePing({ apiKey: mollieToTest });
      await eoPing({ apiKey: eoToTest });
      setInfo("Both API keys look good.");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      let resolvedListId = listId;
      let resolvedListName = lists.find((l) => l.id === listId)?.name ?? null;
      if (!resolvedListId && newListName.trim()) {
        // Creating a list needs the EO key. Prefer the typed one; otherwise
        // lazy-load the saved one for this single call.
        const apiKey =
          eoKey || (await getCredentials()).emailoctopus_api_key || "";
        if (!apiKey) {
          setError("Missing EmailOctopus API key.");
          setBusy(false);
          return;
        }
        const created = await createList({ apiKey }, newListName.trim());
        resolvedListId = created.id;
        resolvedListName = created.name;
      }
      if (!resolvedListId) {
        setError("Pick a list or enter a name to create one.");
        setBusy(false);
        return;
      }

      // Send only the keys the user actually changed. The backend treats
      // null fields as "leave as-is", so we don't clobber the other key.
      const patch: Credentials = {
        mollie_api_key: mollieKey || null,
        emailoctopus_api_key: eoKey || null,
      };
      const cfg: AppConfig = {
        ...config,
        emailoctopus_list_id: resolvedListId,
        emailoctopus_list_name: resolvedListName,
        // Only re-detect mode if the user actually typed a new Mollie key.
        mollie_mode: mollieKey ? detectMode(mollieKey) : config.mollie_mode,
        sync_interval_minutes: intervalMinutes,
      };
      if (patch.mollie_api_key || patch.emailoctopus_api_key) {
        await setCredentials(patch);
      }
      await saveConfig(cfg);

      // Autostart can change independently of the config save above.
      if (autostart !== null) {
        const currentlyEnabled = await isAutostartEnabled();
        if (autostart && !currentlyEnabled) await enableAutostart();
        else if (!autostart && currentlyEnabled) await disableAutostart();
      }

      onSaved(cfg);
      setInfo("Settings saved.");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function manualUpdateCheck() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const update = await checkForUpdate();
      if (update) {
        // Hand the found update up to App.tsx so the banner on the main
        // view actually renders when the user navigates back. Without
        // this, Settings just told them an update was available but the
        // main view had no way to know.
        onUpdateFound(update);
        setInfo(
          `Update v${update.version} is available — return to the main view to install it.`,
        );
      } else {
        setInfo("You're on the latest version.");
      }
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (
      !window.confirm(
        "Clear API keys and reset configuration? You'll need to re-run setup.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await clearCredentials();
      await saveConfig({
        emailoctopus_list_id: null,
        emailoctopus_list_name: null,
        mollie_mode: null,
        last_sync_at: null,
        last_sync_summary: null,
        sync_interval_minutes: null,
      });
      // Take ourselves out of autostart on reset.
      try {
        if (await isAutostartEnabled()) await disableAutostart();
      } catch {
        /* best-effort */
      }
      onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">Settings</h2>

      <div className="field">
        <label htmlFor="mollie">Mollie API key</label>
        <input
          id="mollie"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="•••• saved — leave blank to keep"
          value={mollieKey}
          onChange={(e) => setMollieKey(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="eo">EmailOctopus API key</label>
        <input
          id="eo"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="•••• saved — leave blank to keep"
          value={eoKey}
          onChange={(e) => setEoKey(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="list">
          EmailOctopus list {loadingLists && <Spinner />}
        </label>
        <select
          id="list"
          value={listId}
          onChange={(e) => {
            setListId(e.target.value);
            setNewListName("");
          }}
        >
          <option value="">— or create a new one below —</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="newList">Create a new list</label>
        <input
          id="newList"
          type="text"
          placeholder="e.g. Mollie customers"
          value={newListName}
          onChange={(e) => {
            setNewListName(e.target.value);
            if (e.target.value) setListId("");
          }}
        />
      </div>

      <div className="field">
        <label htmlFor="interval">Automatic sync</label>
        <select
          id="interval"
          value={intervalMinutes === null ? "never" : String(intervalMinutes)}
          onChange={(e) =>
            setIntervalMinutes(
              e.target.value === "never" ? null : Number(e.target.value),
            )
          }
        >
          {SYNC_INTERVAL_CHOICES.map((c) => (
            <option
              key={c.label}
              value={c.minutes === null ? "never" : String(c.minutes)}
            >
              {c.label}
            </option>
          ))}
        </select>
        <div className="field__help">
          The app must stay running (in the tray) for automatic syncs to fire.
        </div>
      </div>

      <div className="field">
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!autostart}
            disabled={autostart === null}
            onChange={(e) => setAutostart(e.target.checked)}
          />
          <span>Start automatically when I log in</span>
        </label>
        <div className="field__help">
          Adds the app to your operating system's login items.
        </div>
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {info && <div className="notice notice--success">{info}</div>}

      <div className="row row--between" style={{ marginTop: 12 }}>
        <div className="row">
          <Button variant="secondary" onClick={openLogsFolder} disabled={busy}>
            Open logs folder
          </Button>
          <Button
            variant="secondary"
            onClick={manualUpdateCheck}
            disabled={busy}
          >
            Check for updates
          </Button>
          <Button variant="danger" onClick={reset} disabled={busy}>
            Clear & reset
          </Button>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={testConnections} disabled={busy}>
            Test connection
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
