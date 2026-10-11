import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMembership } from "@/lib/orgs";

/**
 * Deactivate → Reassign → Preserve History (PRD §32).
 * Body: { mode: "all" | "selected", reassignTo?: string | null, contactIds?: string[] }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const user = await requireUser();
    const { id: orgId, userId } = await params;
    await requireMembership(user.id, orgId, true);
    if (userId === user.id) {
      return NextResponse.json({ error: "You cannot deactivate yourself" }, { status: 400 });
    }
    const target = await prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!target || !target.active) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const { mode, reassignTo, contactIds } = (await req.json()) as {
      mode?: "all" | "selected";
      reassignTo?: string | null;
      contactIds?: string[];
    };
    if (reassignTo) {
      const nm = await prisma.membership.findUnique({
        where: { orgId_userId: { orgId, userId: reassignTo } },
      });
      if (!nm || !nm.active) return NextResponse.json({ error: "Reassign target must be active" }, { status: 400 });
    }

    const where: Record<string, unknown> = { orgId, assignedAgentId: userId };
    if (mode === "selected") {
      if (!contactIds?.length) return NextResponse.json({ error: "contactIds required for selected mode" }, { status: 400 });
      (where as { id: unknown }).id = { in: contactIds };
    }

    const result = await prisma.$transaction(async (tx) => {
      const moved = await tx.contact.updateMany({
        where: where as never,
        data: { assignedAgentId: reassignTo ?? null },
      });
      await tx.membership.update({ where: { id: target.id }, data: { active: false } });
      await tx.activity.create({
        data: {
          orgId,
          type: "member.deactivated",
          actorId: user.id,
          payload: { userId, reassigned: moved.count, reassignTo: reassignTo ?? null },
        },
      });
      return moved.count;
    });
    return NextResponse.json({ ok: true, reassigned: result });
  } catch (e) {
    return e as Response;
  }
}
