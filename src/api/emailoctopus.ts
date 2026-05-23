import { fetch } from "@tauri-apps/plugin-http";
import { ApiError, NetworkError } from "./errors";

// EmailOctopus API v2.
// Docs: https://emailoctopus.com/api-documentation/v2
const BASE_URL = "https://api.emailoctopus.com";

export interface EOList {
  id: string;
  name: string;
  created_at?: string;
  double_opt_in?: boolean;
  fields?: EOListField[];
  counts?: {
    pending?: number;
    subscribed?: number;
    unsubscribed?: number;
  };
}

export interface EOListField {
  tag: string;
  type: string;
  label: string;
  fallback?: string | null;
}

export interface EOContact {
  id: string;
  email_address: string;
  fields: Record<string, unknown>;
  tags: string[];
  status: ContactStatus;
  created_at: string;
  last_updated_at?: string;
}

export type ContactStatus = "pending" | "subscribed" | "unsubscribed";

export interface EOCredentials {
  apiKey: string;
}

export interface UpsertContactInput {
  email: string;
  fields?: Record<string, string | number | null>;
  // v2 wants tags as { tag_name: true | false }, NOT a string array.
  tags?: Record<string, boolean>;
  status?: ContactStatus;
}

export interface UpsertResult {
  contact: EOContact;
  outcome: "added" | "updated";
}

interface Paginated<T> {
  data: T[];
  paging: {
    next?: { url: string; starting_after: string } | null;
    previous?: { url: string; starting_after: string } | null;
  };
}

interface RfcProblem {
  title?: string;
  detail?: string;
  status?: number;
  type?: string;
  errors?: { detail: string; pointer?: string }[];
}

const DUPLICATE_TYPE_SUFFIX = "#already-exists";

async function request<T>(
  { apiKey }: EOCredentials,
  method: string,
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "mollie-octopus-sync/0.1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new NetworkError(`EmailOctopus request failed: ${url}`, e);
  }

  // Soft retry on rate limit. The bucket refills at 10 tokens/s, so a short
  // backoff is enough; we cap at three retries to avoid getting stuck.
  if (response.status === 429 && attempt < 3) {
    const remaining = parseInt(
      response.headers.get("X-RateLimiting-Remaining") ?? "0",
      10,
    );
    const waitMs = remaining > 0 ? 250 : 1100 * (attempt + 1);
    await sleep(waitMs);
    return request<T>({ apiKey }, method, path, body, attempt + 1);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(
      `EmailOctopus ${response.status} on ${method} ${path}`,
      response.status,
      url,
      text,
    );
  }
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      `EmailOctopus returned non-JSON on ${method} ${path}`,
      response.status,
      url,
      text,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ping(creds: EOCredentials): Promise<boolean> {
  await request(creds, "GET", "/lists?limit=1");
  return true;
}

export async function listLists(creds: EOCredentials): Promise<EOList[]> {
  const out: EOList[] = [];
  let url: string | null = "/lists?limit=100";
  while (url) {
    const page: Paginated<EOList> = await request(creds, "GET", url);
    out.push(...page.data);
    url = page.paging?.next?.url ?? null;
  }
  return out;
}

export async function createList(
  creds: EOCredentials,
  name: string,
): Promise<EOList> {
  return await request<EOList>(creds, "POST", "/lists", { name });
}

export async function upsertContact(
  creds: EOCredentials,
  listId: string,
  input: UpsertContactInput,
): Promise<UpsertResult> {
  const email = input.email.trim().toLowerCase();
  const payload: Record<string, unknown> = {
    email_address: email,
    status: input.status ?? "subscribed",
  };
  if (input.fields) payload.fields = input.fields;
  if (input.tags) payload.tags = input.tags;

  // PUT /lists/{id}/contacts is the v2 upsert: create-if-missing,
  // update-if-existing. It returns the existing contact's created_at so we
  // can tell which path the API took.
  const before = nowIso();
  const contact = await request<EOContact>(
    creds,
    "PUT",
    `/lists/${listId}/contacts`,
    payload,
  );
  const outcome: "added" | "updated" =
    contact.created_at && contact.created_at >= before ? "added" : "updated";
  return { contact, outcome };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isDuplicateError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status !== 409) return false;
  try {
    const problem = JSON.parse(e.body) as RfcProblem;
    return (problem.type ?? "").endsWith(DUPLICATE_TYPE_SUFFIX);
  } catch {
    return true;
  }
}

export function extractErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const problem = JSON.parse(e.body) as RfcProblem;
      const fieldErrors = (problem.errors ?? [])
        .map((er) => `${er.pointer ?? ""} ${er.detail}`.trim())
        .filter(Boolean)
        .join("; ");
      const main = problem.detail ?? problem.title ?? e.message;
      return fieldErrors ? `${main} (${fieldErrors})` : main;
    } catch {
      return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
