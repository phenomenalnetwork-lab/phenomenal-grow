import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMembership } from "@/lib/orgs";

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId");
    if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
    await requireMembership(user.id, orgId);
    return NextResponse.json(
      await prisma.savedView.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    );
  } catch (e) {
    return e as Response;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { orgId, name, filters } = (await req.json()) as { orgId?: string; name?: string; filters?: any };
    if (!orgId || !name?.trim() || !filters) {
      return NextResponse.json({ error: "orgId, name and filters required" }, { status: 400 });
    }
    await requireMembership(user.id, orgId);
    const view = await prisma.savedView.create({
      data: { orgId, ownerId: user.id, name: name.trim(), filters },
    });
    return NextResponse.json(view, { status: 201 });
  } catch (e) {
    return e as Response;
  }
}
