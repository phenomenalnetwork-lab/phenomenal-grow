import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE } from "./orgs";

const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/** Server-side fetch to the NestJS API, forwarding session cookies + org scope. */
export async function apiFetch<T = any>(
  path: string,
  init?: { method?: string; body?: unknown; orgId?: string },
): Promise<{ ok: boolean; status: number; data: T }> {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = init?.orgId ?? jar.get(ACTIVE_ORG_COOKIE)?.value ?? "";
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "x-org-id": orgId,
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
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
