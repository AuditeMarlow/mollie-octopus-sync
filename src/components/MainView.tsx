import { useState } from "react";
import { Button } from "./Button";
import { SyncProgress } from "./SyncProgress";
import type { UseSync } from "../sync/useSync";
import type { AppConfig, SyncSummary } from "../types";

interface Props {
  config: AppConfig;
  hasCredentials: boolean;
  sync: UseSync;
  onOpenSettings: () => void;
}

export function MainView({
  config,
  hasCredentials,
  sync,
  onOpenSettings,
}: Props) {
  const [dryRun, setDryRun] = useState(false);

  const ready = !!config.emailoctopus_list_id && hasCredentials;

  return (
    <>
      <div className="card">
        <h2 className="card__title">Status</h2>
        <dl className="kv">
          <dt>List</dt>
          <dd>
            {config.emailoctopus_list_name ?? <em>(none selected)</em>}{" "}
            {config.emailoctopus_list_id && (
              <span className="muted">· {config.emailoctopus_list_id}</span>
            )}
          </dd>
          <dt>Mollie mode</dt>
          <dd>
            {config.mollie_mode ? (
              <strong
                style={{
                  color:
                    config.mollie_mode === "live"
                      ? "var(--success)"
                      : "var(--warning)",
                }}
              >
                {config.mollie_mode.toUpperCase()}
              </strong>
            ) : (
              <em>unknown</em>
            )}
          </dd>
          <dt>Auto-sync</dt>
          <dd>
            {config.sync_interval_minutes && config.sync_interval_minutes > 0
              ? `every ${formatMinutes(config.sync_interval_minutes)}`
              : "off — manual only"}
          </dd>
          <dt>Last sync</dt>
          <dd>
            {config.last_sync_at ? (
              <>
                {formatDate(config.last_sync_at)}
                {config.last_sync_summary && (
                  <span className="muted">
                    {" — "}
                    {summarize(config.last_sync_summary)}
                  </span>
                )}
              </>
            ) : (
              <em>never</em>
            )}
          </dd>
        </dl>

        <div className="row row--between" style={{ marginTop: 16 }}>
          <label className="row" style={{ gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={sync.running}
            />
            <span className="muted">
              Dry run (skip writing to EmailOctopus)
            </span>
          </label>

          <div className="row">
            <Button
              variant="secondary"
              onClick={onOpenSettings}
              disabled={sync.running}
            >
              Settings
            </Button>
            {sync.running ? (
              <Button variant="danger" onClick={sync.cancel}>
                Cancel
              </Button>
            ) : (
              <Button
                onClick={() => void sync.start({ dryRun })}
                disabled={!ready}
              >
                Sync Contacts
              </Button>
            )}
          </div>
        </div>
      </div>

      {sync.error && <div className="notice notice--error">{sync.error}</div>}

      {sync.progress && <SyncProgress state={sync.progress} />}

      {sync.progress?.phase === "done" && sync.progress.failures.length > 0 && (
        <div className="notice notice--warn">
          {sync.progress.failures.length} payment
          {sync.progress.failures.length === 1 ? "" : "s"} couldn't be synced.
          Open the logs folder from Settings for full detail.
        </div>
      )}
    </>
  );
}

function summarize(s: SyncSummary): string {
  return `${s.added} added, ${s.updated} updated, ${s.skipped} skipped, ${s.failed} failed`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}
