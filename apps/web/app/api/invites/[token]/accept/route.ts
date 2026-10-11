import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/orgs";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireUser();
    const { token } = await params;
    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt) {
      return NextResponse.json({ error: "Invite invalid or already used" }, { status: 404 });
    }
    if (invite.email !== user.email.toLowerCase()) {
      return NextResponse.json({ error: "Invite is for a different email" }, { status: 403 });
    }
    await prisma.$transaction([
      prisma.membership.upsert({
        where: { orgId_userId: { orgId: invite.orgId, userId: user.id } },
        update: { role: invite.role, active: true },
        create: { orgId: invite.orgId, userId: user.id, role: invite.role, active: true },
      }),
      prisma.invite.update({ where: { token }, data: { acceptedAt: new Date() } }),
      prisma.activity.create({
        data: { orgId: invite.orgId, type: "member.joined", actorId: user.id },
      }),
    ]);
    return NextResponse.json({ ok: true, orgId: invite.orgId });
  } catch (e) {
    return e as Response;
  }
}
