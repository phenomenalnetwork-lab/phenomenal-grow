import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, myMemberships, slugify } from "@/lib/orgs";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await myMemberships(user.id));
  } catch (e) {
    return e as Response;
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { name } = (await req.json()) as { name?: string };
    if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const base = slugify(name);
    let slug = base;
    for (let i = 2; await prisma.organisation.findUnique({ where: { slug } }); i++) {
      slug = `${base}-${i}`;
    }

    const org = await prisma.organisation.create({
      data: {
        name: name.trim(),
        slug,
        memberships: { create: { userId: user.id, role: "OWNER", active: true } },
      },
    });
    await prisma.activity.create({
      data: { orgId: org.id, type: "org.created", actorId: user.id },
    });
    return NextResponse.json(org, { status: 201 });
  } catch (e) {
    return e as Response;
  }
}
