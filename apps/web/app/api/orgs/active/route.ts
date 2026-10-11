import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE, requireUser, requireMembership } from "@/lib/orgs";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { orgId } = (await req.json()) as { orgId?: string };
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
    await requireMembership(user.id, orgId);
    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return e as Response;
  }
}
