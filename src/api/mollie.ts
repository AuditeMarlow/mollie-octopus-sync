import { fetch } from "@tauri-apps/plugin-http";
import { ApiError, NetworkError } from "./errors";

const BASE_URL = "https://api.mollie.com/v2";
const MAX_PAGE_SIZE = 250;

export type MolliePaymentStatus =
  | "open"
  | "canceled"
  | "pending"
  | "authorized"
  | "expired"
  | "failed"
  | "paid";

export interface MollieAmount {
  currency: string;
  value: string;
}

export interface MolliePayment {
  resource: "payment";
  id: string;
  status: MolliePaymentStatus;
  mode: "live" | "test";
  description: string;
  amount: MollieAmount;
  createdAt: string;
  paidAt?: string;
  billingEmail?: string;
  customerId?: string;
  metadata?: Record<string, unknown> | null;
  details?: {
    consumerName?: string;
    cardHolder?: string;
    [key: string]: unknown;
  };
}

export interface MollieCustomer {
  resource: "customer";
  id: string;
  name?: string;
  email?: string;
  locale?: string;
}

interface MollieListEnvelope<TKey extends string, T> {
  count: number;
  _embedded: Record<TKey, T[]> & Partial<Record<string, T[]>>;
  _links: {
    self: { href: string; type: string };
    next?: { href: string; type: string } | null;
    previous?: { href: string; type: string } | null;
  };
}

export interface MollieCredentials {
  apiKey: string;
}

export function detectMode(apiKey: string): "live" | "test" | null {
  if (apiKey.startsWith("live_")) return "live";
  if (apiKey.startsWith("test_")) return "test";
  return null;
}

async function request<T>(
  { apiKey }: MollieCredentials,
  path: string,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "mollie-octopus-sync/0.1",
      },
    });
  } catch (e) {
    throw new NetworkError(`Mollie request failed: ${url}`, e);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(
      `Mollie ${response.status} on ${path}`,
      response.status,
      url,
      text,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      `Mollie returned non-JSON on ${path}`,
      response.status,
      url,
      text,
    );
  }
}

export async function ping(creds: MollieCredentials): Promise<boolean> {
  // Cheapest authenticated endpoint we can reach.
  await request(creds, `/payments?limit=1`);
  return true;
}

export interface PaymentsPage {
  payments: MolliePayment[];
  nextHref: string | null;
}

export async function fetchPaymentsPage(
  creds: MollieCredentials,
  cursorHref: string | null,
): Promise<PaymentsPage> {
  const path = cursorHref ?? `/payments?limit=${MAX_PAGE_SIZE}`;
  const data = await request<MollieListEnvelope<"payments", MolliePayment>>(
    creds,
    path,
  );
  const payments =
    data._embedded?.payments ?? data._embedded?.["payments"] ?? [];
  const nextHref = data._links?.next?.href ?? null;
  return { payments, nextHref };
}

export async function* iteratePayments(
  creds: MollieCredentials,
  onPage?: (count: number) => void,
): AsyncGenerator<MolliePayment, void, void> {
  let cursor: string | null = null;
  let fetched = 0;
  do {
    const page: PaymentsPage = await fetchPaymentsPage(creds, cursor);
    fetched += page.payments.length;
    onPage?.(fetched);
    for (const p of page.payments) yield p;
    cursor = page.nextHref;
  } while (cursor);
}

const customerCache = new Map<string, MollieCustomer | null>();

export async function fetchCustomer(
  creds: MollieCredentials,
  customerId: string,
): Promise<MollieCustomer | null> {
  if (customerCache.has(customerId)) return customerCache.get(customerId)!;
  try {
    const c = await request<MollieCustomer>(creds, `/customers/${customerId}`);
    customerCache.set(customerId, c);
    return c;
  } catch (e) {
    if (e instanceof ApiError && e.isNotFound) {
      customerCache.set(customerId, null);
      return null;
    }
    throw e;
  }
}

export function clearCustomerCache(): void {
  customerCache.clear();
}
