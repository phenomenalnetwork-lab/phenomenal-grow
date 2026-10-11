import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMembership } from "@/lib/orgs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireMembership(user.id, id, true);

    const { email, role } = (await req.json()) as { email?: string; role?: "OWNER" | "AGENT" };
    if (!email?.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 });

    const invite = await prisma.invite.create({
      data: { orgId: id, email: email.toLowerCase().trim(), role: role === "OWNER" ? "OWNER" : "AGENT" },
    });
    return NextResponse.json(invite, { status: 201 });
  } catch (e) {
    return e as Response;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireMembership(user.id, id, true);
    return NextResponse.json(
      await prisma.invite.findMany({ where: { orgId: id }, orderBy: { createdAt: "desc" } }),
    );
  } catch (e) {
    return e as Response;
  }
}
