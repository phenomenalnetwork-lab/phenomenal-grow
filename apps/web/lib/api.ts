import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE } from "./orgs";

const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Fail-fast budget for API calls. Must stay well under the serverless
 * function timeout: a hung upstream (e.g. a sleeping backend waking up)
 * must surface as an actionable error, never as a 30s+ killed stream that
 * the browser reports as "Connection closed".
 */
const API_TIMEOUT_MS = 8000;

/** Server-side fetch to the NestJS API, forwarding session cookies + org scope. */
export async function apiFetch<T = any>(
  path: string,
  init?: { method?: string; body?: unknown; orgId?: string },
): Promise<{ ok: boolean; status: number; data: T }> {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = init?.orgId ?? jar.get(ACTIVE_ORG_COOKIE)?.value ?? "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "x-org-id": orgId,
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(
        "The CRM API did not answer within 8 seconds — it may be waking from sleep. Wait a minute and retry; if it persists, check that the API service is running.",
        { cause: e },
      );
    }
    throw new Error("The CRM API request failed before a response was received.", { cause: e });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

export async function activeOrgId(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
}
