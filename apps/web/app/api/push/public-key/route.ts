import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const orgId = jar.get("pgrow-org")?.value ?? "";
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
  const res = await fetch(`${base}/notifications/push/public-key`, {
    headers: { Cookie: cookie, "x-org-id": orgId },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ key: null }));
  return NextResponse.json(data);
}
