import type { SyncProgress as SyncProgressState } from "../types";
import { Spinner } from "./Spinner";

interface Props {
  state: SyncProgressState;
}

export function SyncProgress({ state }: Props) {
  const pct =
    state.phase === "syncing" && state.total
      ? Math.round((state.processed / state.total) * 100)
      : state.phase === "done"
        ? 100
        : null;

  return (
    <div className="card">
      <div className="row row--between" style={{ marginBottom: 10 }}>
        <strong>
          {state.phase === "fetching"
            ? "Fetching Mollie payments…"
            : state.phase === "syncing"
              ? `Syncing contacts ${state.processed}/${state.total ?? "?"}`
              : "Sync complete"}
        </strong>
        {state.phase !== "done" && <Spinner />}
      </div>

      <div className="progress">
        <div className="progress__bar">
          <div
            className="progress__fill"
            style={{
              width:
                pct === null
                  ? `${Math.min(state.fetched, 250) / 2.5}%`
                  : `${pct}%`,
            }}
          />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Fetched {state.fetched} payments · added {state.summary.added}·
          updated {state.summary.updated} · skipped {state.summary.skipped}·
          failed {state.summary.failed}
        </div>
      </div>

      {state.failures.length > 0 && (
        <ul className="failures">
          {state.failures.slice(-8).map((f, i) => (
            <li key={i}>
              {f.email ?? "(no email)"} — {f.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
