import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

async function forward(path: string, init?: RequestInit) {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = jar.get("pgrow-org")?.value ?? "";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, "x-org-id": orgId, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}

export async function GET() {
  return forward("/notifications/push/public-key");
}

export async function POST(req: Request) {
  return forward("/notifications/push/subscriptions", { method: "POST", body: JSON.stringify(await req.json()) });
}
