import type { MolliePayment, MollieCustomer } from "../api/mollie";
import type { NormalizedContact } from "../types";

// Liberal but pragmatic email check. We're not enforcing RFC 5322 — just
// rejecting things that obviously won't deliver and can't be the user's intent.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  return e;
}

export function splitName(full: string | undefined | null): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!full) return { firstName: null, lastName: null };
  const trimmed = full.trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: null, lastName: null };
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1),
  };
}

export interface NormalizeContext {
  customers: Map<string, MollieCustomer | null>;
}

export function normalizePayment(
  payment: MolliePayment,
  ctx: NormalizeContext,
): NormalizedContact | null {
  const customer = payment.customerId
    ? (ctx.customers.get(payment.customerId) ?? null)
    : null;

  const email = normalizeEmail(payment.billingEmail ?? customer?.email);
  if (!email) return null;

  const rawName =
    customer?.name ??
    payment.details?.consumerName ??
    payment.details?.cardHolder ??
    metadataString(payment.metadata, ["customer_name", "name", "fullName"]) ??
    null;
  const { firstName, lastName } = splitName(rawName);

  return {
    email,
    firstName,
    lastName,
    productName: payment.description?.trim() || null,
    paymentId: payment.id,
    paymentDate: payment.paidAt ?? payment.createdAt,
  };
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!metadata) return null;
  for (const k of keys) {
    const v = metadata[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Last-seen wins. When the same email has multiple paid payments, we want the
// most recent one's product/date in EmailOctopus so the contact reflects their
// latest purchase, not a long-forgotten one.
export function mergeByEmail(
  contacts: NormalizedContact[],
): NormalizedContact[] {
  const byEmail = new Map<string, NormalizedContact>();
  for (const c of contacts) {
    const existing = byEmail.get(c.email);
    if (!existing || c.paymentDate > existing.paymentDate) {
      byEmail.set(c.email, c);
    }
  }
  return Array.from(byEmail.values());
}
