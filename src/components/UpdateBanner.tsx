import { useState } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";
import type { AvailableUpdate } from "../lib/updater";

interface Props {
  update: AvailableUpdate;
  onDismiss: () => void;
}

export function UpdateBanner({ update, onDismiss }: Props) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setError(null);
    setInstalling(true);
    try {
      await update.install();
      // If install() returns without relaunch the app is closing — nothing to do.
    } catch (e) {
      setError(formatError(e));
      setInstalling(false);
    }
  }

  return (
    <div className="notice notice--success" style={{ marginBottom: 0 }}>
      <div className="row row--between" style={{ alignItems: "center" }}>
        <span>
          <strong>Update available:</strong> v{update.version}
          <span className="muted"> (you're on v{update.currentVersion})</span>
        </span>
        <div className="row" style={{ gap: 6 }}>
          <Button variant="secondary" onClick={onDismiss} disabled={installing}>
            Later
          </Button>
          <Button onClick={install} disabled={installing}>
            {installing ? <Spinner /> : "Install & restart"}
          </Button>
        </div>
      </div>
      {update.notes && (
        <details style={{ marginTop: 8 }}>
          <summary
            className="muted"
            style={{ cursor: "pointer", fontSize: 12 }}
          >
            Release notes
          </summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              margin: "8px 0 0",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {update.notes}
          </pre>
        </details>
      )}
      {error && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {error}
        </div>
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
