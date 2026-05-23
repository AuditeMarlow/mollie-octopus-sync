import {
  clearCustomerCache,
  fetchCustomer,
  iteratePayments,
  type MollieCredentials,
  type MollieCustomer,
} from "../api/mollie";
import {
  extractErrorMessage,
  upsertContact,
  type EOCredentials,
  type UpsertContactInput,
} from "../api/emailoctopus";
import { mergeByEmail, normalizePayment } from "./normalize";
import { logLine } from "../lib/tauri";
import type {
  NormalizedContact,
  SyncFailure,
  SyncProgress,
  SyncSummary,
} from "../types";

export interface SyncOptions {
  mollie: MollieCredentials;
  emailoctopus: EOCredentials;
  listId: string;
  /** Add this tag to every contact we touch. Helpful for ops in EmailOctopus. */
  tag?: string;
  /** If true, do everything except the final upsert call. */
  dryRun?: boolean;
  /** Abort signal — flip aborted to stop mid-sync. */
  signal?: AbortSignal;
  onProgress?: (p: SyncProgress) => void;
}

export interface SyncResult {
  summary: SyncSummary;
  failures: SyncFailure[];
  startedAt: string;
  finishedAt: string;
  contactsTouched: number;
}

export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const summary: SyncSummary = { added: 0, updated: 0, skipped: 0, failed: 0 };
  const failures: SyncFailure[] = [];

  const progress: SyncProgress = {
    phase: "fetching",
    fetched: 0,
    processed: 0,
    total: null,
    summary,
    failures,
  };
  const emit = () => opts.onProgress?.({ ...progress, summary, failures });

  await logLine("info", `sync start dryRun=${!!opts.dryRun}`);

  clearCustomerCache();

  // Phase 1: pull every paid payment and stage normalized contact records.
  const collected: NormalizedContact[] = [];
  const customerCache = new Map<string, MollieCustomer | null>();

  try {
    for await (const payment of iteratePayments(opts.mollie, (n) => {
      progress.fetched = n;
      emit();
    })) {
      throwIfAborted(opts.signal);

      // Resolve customer once per customerId. Mollie payment.billingEmail is
      // often missing for stored customers, so the customer endpoint is the
      // fallback. Cache misses cost one extra request per unique customer.
      if (payment.customerId && !customerCache.has(payment.customerId)) {
        try {
          const c = await fetchCustomer(opts.mollie, payment.customerId);
          customerCache.set(payment.customerId, c);
        } catch (e) {
          customerCache.set(payment.customerId, null);
          await logLine(
            "warn",
            `customer fetch failed ${payment.customerId}: ${extractErrorMessage(e)}`,
          );
        }
      }

      const normalized = normalizePayment(payment, {
        customers: customerCache,
      });
      if (!normalized) {
        summary.skipped += 1;
        failures.push({
          email: null,
          paymentId: payment.id,
          reason: "no usable email on payment",
        });
        emit();
        continue;
      }
      collected.push(normalized);
    }
  } catch (e) {
    await logLine("error", `fetch failed: ${extractErrorMessage(e)}`);
    throw e;
  }

  // Phase 2: dedupe by email (latest payment wins) and upsert into EmailOctopus.
  const unique = mergeByEmail(collected);
  progress.phase = "syncing";
  progress.total = unique.length;
  progress.processed = 0;
  emit();

  for (const contact of unique) {
    throwIfAborted(opts.signal);
    try {
      if (opts.dryRun) {
        summary.skipped += 1;
      } else {
        const input = toUpsert(contact, opts.tag);
        const { outcome } = await upsertContact(
          opts.emailoctopus,
          opts.listId,
          input,
        );
        if (outcome === "added") summary.added += 1;
        else summary.updated += 1;
      }
    } catch (e) {
      summary.failed += 1;
      const reason = extractErrorMessage(e);
      failures.push({
        email: contact.email,
        paymentId: contact.paymentId,
        reason,
      });
      await logLine(
        "error",
        `upsert failed email=${contact.email} payment=${contact.paymentId}: ${reason}`,
      );
    }
    progress.processed += 1;
    emit();
  }

  progress.phase = "done";
  emit();

  const finishedAt = new Date().toISOString();
  await logLine(
    "info",
    `sync done added=${summary.added} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed} unique=${unique.length}`,
  );

  return {
    summary,
    failures,
    startedAt,
    finishedAt,
    contactsTouched: unique.length,
  };
}

function toUpsert(c: NormalizedContact, tag?: string): UpsertContactInput {
  const fields: Record<string, string> = {};
  if (c.firstName) fields.FirstName = c.firstName;
  if (c.lastName) fields.LastName = c.lastName;
  return {
    email: c.email,
    fields,
    status: "subscribed",
    tags: tag ? { [tag]: true } : undefined,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Sync aborted", "AbortError");
}
