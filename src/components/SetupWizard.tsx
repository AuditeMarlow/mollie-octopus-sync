import { useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import { ping as molliePing, detectMode } from "../api/mollie";
import {
  createList,
  listLists,
  ping as eoPing,
  type EOList,
} from "../api/emailoctopus";
import { saveConfig, setCredentials } from "../lib/tauri";
import type { AppConfig, Credentials } from "../types";
import { DEFAULT_SYNC_INTERVAL_MINUTES } from "../types";

interface Props {
  onComplete: (config: AppConfig) => void;
}

type Step = "keys" | "list" | "done";

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("keys");
  const [mollieKey, setMollieKey] = useState("");
  const [eoKey, setEoKey] = useState("");
  const [lists, setLists] = useState<EOList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mode = detectMode(mollieKey);

  async function verifyAndContinue() {
    setError(null);
    if (!mollieKey || !eoKey) {
      setError("Both API keys are required.");
      return;
    }
    if (!mode) {
      setError("Mollie key should start with live_ or test_.");
      return;
    }
    setBusy(true);
    try {
      await molliePing({ apiKey: mollieKey });
      await eoPing({ apiKey: eoKey });
      const fetched = await listLists({ apiKey: eoKey });
      setLists(fetched);
      if (fetched.length > 0) setSelectedListId(fetched[0].id);
      setStep("list");
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    setError(null);
    setBusy(true);
    try {
      let list: EOList | undefined = lists.find((l) => l.id === selectedListId);
      if (!list && newListName.trim()) {
        list = await createList({ apiKey: eoKey }, newListName.trim());
      }
      if (!list) {
        setError("Pick an existing list or enter a name to create one.");
        setBusy(false);
        return;
      }
      const creds: Credentials = {
        mollie_api_key: mollieKey,
        emailoctopus_api_key: eoKey,
      };
      const cfg: AppConfig = {
        emailoctopus_list_id: list.id,
        emailoctopus_list_name: list.name,
        mollie_mode: mode,
        last_sync_at: null,
        last_sync_summary: null,
        sync_interval_minutes: DEFAULT_SYNC_INTERVAL_MINUTES,
      };
      await setCredentials(creds);
      await saveConfig(cfg);
      onComplete(cfg);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="wizard__steps">
        <span className={step === "keys" ? "wizard__step--active" : ""}>
          1. API keys
        </span>
        <span>›</span>
        <span className={step === "list" ? "wizard__step--active" : ""}>
          2. Pick list
        </span>
      </div>

      {step === "keys" && (
        <>
          <div className="field">
            <label htmlFor="mollie">Mollie API key</label>
            <input
              id="mollie"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="live_xxx or test_xxx"
              value={mollieKey}
              onChange={(e) => setMollieKey(e.target.value)}
            />
            <div className="field__help">
              Get yours from Peggy Pay → Account → Bedrijfsprofiel → Bewerken →
              Betaalinstellingen, or directly from{" "}
              <a
                href="https://my.mollie.com/dashboard/developers/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                your Mollie dashboard
              </a>
              .
            </div>
          </div>

          <div className="field">
            <label htmlFor="eo">EmailOctopus API key</label>
            <input
              id="eo"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="eo_..."
              value={eoKey}
              onChange={(e) => setEoKey(e.target.value)}
            />
            <div className="field__help">
              Generate one at{" "}
              <a
                href="https://emailoctopus.com/developer/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                EmailOctopus → Developer → API keys
              </a>
              .
            </div>
          </div>

          {error && <div className="notice notice--error">{error}</div>}

          <div className="row row--end" style={{ marginTop: 12 }}>
            <Button onClick={verifyAndContinue} disabled={busy}>
              {busy ? <Spinner /> : "Continue"}
            </Button>
          </div>
        </>
      )}

      {step === "list" && (
        <>
          <div className="field">
            <label htmlFor="list">Pick an existing list</label>
            <select
              id="list"
              value={selectedListId}
              onChange={(e) => {
                setSelectedListId(e.target.value);
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
            <label htmlFor="newList">Or create a new list</label>
            <input
              id="newList"
              type="text"
              placeholder="e.g. Peggy Pay customers"
              value={newListName}
              onChange={(e) => {
                setNewListName(e.target.value);
                if (e.target.value) setSelectedListId("");
              }}
            />
          </div>

          {error && <div className="notice notice--error">{error}</div>}

          <div className="row row--between" style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={() => setStep("keys")}>
              Back
            </Button>
            <Button onClick={finalize} disabled={busy}>
              {busy ? <Spinner /> : "Finish setup"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
