import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { WhatsappService } from "./whatsapp.service";
import { MetaProvider } from "./meta.provider";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { testPrisma, truncateAll } from "../test-helpers";

function inbound(id: string, body: string) {
  return {
    providerMessageId: id,
    from: "15551230000",
    profileName: "Ama K.",
    phoneNumberId: "15550009999",
    timestamp: new Date(),
    type: "text",
    text: body,
  };
}

describe("webhook ingest", () => {
  let prisma: PrismaClient;
  let wa: WhatsappService;
  let orgId: string;

  beforeAll(() => {
    prisma = testPrisma();
    const asService = prisma as unknown as PrismaService;
    wa = new WhatsappService(asService, new MetaProvider(), new NotificationsService(asService));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const org = await prisma.organisation.create({ data: { name: "wa-org", slug: `wa-${Date.now()}` } });
    orgId = org.id;
    await prisma.whatsappNumber.create({
      data: { orgId, label: "Test", providerNumberId: "15550009999", accessToken: "test" },
    });
  });

  it("creates contact + conversation on first inbound", async () => {
    const r = await wa.ingest(inbound("wamid.t1", "Hello"));
    expect(r).toMatchObject({ contactId: expect.any(String), conversationId: expect.any(String) });
    const contact = await prisma.contact.findFirstOrThrow({ where: { orgId } });
    expect(contact.name).toBe("Ama K.");
    expect(contact.source).toBe("WhatsApp");
  });

  it("is idempotent on duplicate providerMessageId", async () => {
    await wa.ingest(inbound("wamid.t2", "Hello"));
    await wa.ingest(inbound("wamid.t2", "Hello"));
    expect(await prisma.message.count({ where: { orgId } })).toBe(1);
    expect(await prisma.contact.count({ where: { orgId } })).toBe(1);
  });

  it("reactivates archived contacts instead of duplicating", async () => {
    await prisma.contact.create({
      data: { orgId, name: "Ama K.", phoneE164: "+15551230000", status: "ARCHIVED" },
    });
    await wa.ingest(inbound("wamid.t3", "Back again"));
    expect(await prisma.contact.count({ where: { orgId } })).toBe(1);
    const c = await prisma.contact.findFirstOrThrow({ where: { orgId } });
    expect(c.status).toBe("ACTIVE");
  });

  it("ignores messages for unknown numbers", async () => {
    const r = await wa.ingest({ ...inbound("wamid.t4", "Hi"), phoneNumberId: "0000000000" });
    expect(r).toMatchObject({ ignored: true });
    expect(await prisma.contact.count({ where: { orgId } })).toBe(0);
  });
});
