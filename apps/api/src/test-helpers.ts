import { beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

// Integration specs run ONLY against a scratch *_test database.
// The vitest.setup.ts guard refuses any other connection string.
export function testPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL ?? "";
  if (url === "") throw new Error("TEST_DATABASE_URL is required for integration specs");
  return new PrismaClient({ datasources: { db: { url } } });
}

const TABLES = [
  "Notification",
  "Message",
  "Conversation",
  "Followup",
  "Enrollment",
  "Appointment",
  "ContactPipeline",
  "ContactTag",
  "Note",
  "Activity",
  "Contact",
  "Tag",
  "ContactMerge",
  "SavedView",
  "WhatsappNumber",
  "Membership",
  "Invite",
  "SequenceStep",
  "Sequence",
  "CaptureForm",
];

export async function truncateAll(prisma: PrismaClient) {
  for (const t of TABLES) {
    await prisma.$executeRawUnsafe(`TRUNCATE "${t}" CASCADE`);
  }
}

export async function makeOrg(prisma: PrismaClient, slug: string, role: "OWNER" | "AGENT" = "OWNER") {
  const org = await prisma.organisation.create({ data: { name: slug, slug: `${slug}-${Date.now()}` } });
  const user = await prisma.user.create({ data: { name: `${slug}-user`, email: `${slug}-${Date.now()}@t.dev` } });
  const membership = await prisma.membership.create({ data: { orgId: org.id, userId: user.id, role, active: true } });
  return { org, user, membership };
}

beforeEach(() => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for integration specs");
});
