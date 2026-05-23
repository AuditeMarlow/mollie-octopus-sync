export interface Credentials {
  mollie_api_key: string | null;
  emailoctopus_api_key: string | null;
}

export interface SyncSummary {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface AppConfig {
  emailoctopus_list_id: string | null;
  emailoctopus_list_name: string | null;
  mollie_mode: "live" | "test" | null;
  last_sync_at: string | null;
  last_sync_summary: SyncSummary | null;
  /** Minutes between automatic background syncs. `null` or `0` disables. */
  sync_interval_minutes: number | null;
}

export const SYNC_INTERVAL_CHOICES: {
  label: string;
  minutes: number | null;
}[] = [
  { label: "Every 15 minutes", minutes: 15 },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Every 24 hours", minutes: 1440 },
  { label: "Never (manual only)", minutes: null },
];

export const DEFAULT_SYNC_INTERVAL_MINUTES = 30;

export interface NormalizedContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  productName: string | null;
  paymentId: string;
  paymentDate: string;
}

export type SyncOutcome = "added" | "updated" | "skipped" | "failed";

export interface SyncProgress {
  phase: "fetching" | "syncing" | "done";
  fetched: number;
  processed: number;
  total: number | null;
  summary: SyncSummary;
  failures: SyncFailure[];
}

export interface SyncFailure {
  email: string | null;
  paymentId: string | null;
  reason: string;
}
