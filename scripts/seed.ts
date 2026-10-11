/* Phase 0 seed: demo org + owner + agent + sample contact.
 * Full starter pipelines/tags/sequences arrive in Phases 1-4.
 * Run: pnpm db:push && pnpm db:seed (requires DATABASE_URL + Docker pg up).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organisation.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Organisation", slug: "demo" },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: { name: "Demo Owner", email: "owner@example.com" },
  });

  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: owner.id } },
    update: { role: "OWNER", active: true },
    create: { orgId: org.id, userId: owner.id, role: "OWNER", active: true },
  });

  await prisma.contact.upsert({
    where: { orgId_phoneE164: { orgId: org.id, phoneE164: "+10000000001" } },
    update: {},
    create: {
      orgId: org.id,
      name: "Sarah M.",
      phoneE164: "+10000000001",
      status: "ACTIVE",
    },
  });

  await prisma.activity.create({
    data: {
      orgId: org.id,
      type: "seed.completed",
      actorId: owner.id,
      payload: { phase: 0 },
    },
  });

  console.log(`Seeded org ${org.slug}`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
