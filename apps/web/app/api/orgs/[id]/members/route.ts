import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireMembership } from "@/lib/orgs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await requireMembership(user.id, id, true);
    const members = await prisma.membership.findMany({
      where: { orgId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    });
    return NextResponse.json(members);
  } catch (e) {
    return e as Response;
  }
}
