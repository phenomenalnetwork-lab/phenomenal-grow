import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/orgs";

/** Invites waiting for my email address. */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(
      await prisma.invite.findMany({
        where: { email: user.email.toLowerCase(), acceptedAt: null },
        include: { org: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    );
  } catch (e) {
    return e as Response;
  }
}
