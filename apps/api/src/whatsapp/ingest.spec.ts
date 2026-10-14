import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { WhatsappService } from "./whatsapp.service";
import { MetaProvider } from "./meta.provider";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { testPrisma, truncateAll } from "../test-helpers";

vi.mock("@pgrow/storage", () => ({ putObject: vi.fn(async () => "stored") }));

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

function imageInbound(id: string) {
  return {
    providerMessageId: id,
    from: "15551230000",
    profileName: "Ama K.",
    phoneNumberId: "15550009999",
    timestamp: new Date(),
    type: "image",
    mediaId: "media-1",
    mediaMime: "image/jpeg",
  };
}

function stubService(
  prisma: PrismaClient,
  fetchMedia: () => Promise<{ bytes: Uint8Array; mime: string } | null>,
  notify?: { notify: (...args: never[]) => Promise<null>; notifyOwners: (...args: never[]) => Promise<void> },
) {
  const asService = prisma as unknown as PrismaService;
  const provider = {
    name: "stub",
    sendText: async () => ({ providerMessageId: "stub-out", via: "text" as const }),
    sendTemplate: async () => ({ providerMessageId: "stub-tpl", via: "template" as const }),
    sendOutbound: async () => ({ providerMessageId: "stub-out", via: "text" as const }),
    fetchMedia,
  };
  return new WhatsappService(
    asService,
    provider as never,
    (notify ?? new NotificationsService(asService)) as never,
  );
}

describe("notification failures must never lose inbound (2A.2)", () => {
  let prisma: PrismaClient;
  let orgId: string;

  beforeAll(() => {
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const org = await prisma.organisation.create({ data: { name: "wa-notify", slug: `wan-${Date.now()}` } });
    orgId = org.id;
    await prisma.whatsappNumber.create({
      data: { orgId, label: "N", providerNumberId: "15550009999", accessToken: "test" },
    });
  });

  function throwingNotify() {
    return {
      notify: async (..._args: never[]) => {
        throw new Error("notification store down");
      },
      notifyOwners: async (..._args: never[]) => {
        throw new Error("notification store down");
      },
    };
  }

  it("persists the message when notification delivery throws (assigned agent)", async () => {
    const agent = await prisma.user.create({ data: { name: "Ag", email: `agn-${Date.now()}@t.dev` } });
    await prisma.membership.create({ data: { orgId, userId: agent.id, role: "AGENT", active: true } });
    await prisma.contact.create({
      data: { orgId, name: "Ama K.", phoneE164: "+15551230000", assignedAgentId: agent.id },
    });
    const svc = stubService(prisma, async () => null, throwingNotify());
    const r = await svc.ingest(inbound("wamid.n1", "Hello despite notify outage"));
    expect(r).toMatchObject({ contactId: expect.any(String) });
    const msg = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.n1" } });
    expect(msg.body).toBe("Hello despite notify outage");
  });

  it("persists the message when owner-fallback notification throws (unassigned)", async () => {
    const owner = await prisma.user.create({ data: { name: "Ow", email: `own-${Date.now()}@t.dev` } });
    await prisma.membership.create({ data: { orgId, userId: owner.id, role: "OWNER", active: true } });
    const svc = stubService(prisma, async () => null, throwingNotify());
    await svc.ingest(inbound("wamid.n2", "Nobody assigned"));
    await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.n2" } });
  });

  it("still creates the notification when delivery works", async () => {
    const agent = await prisma.user.create({ data: { name: "Ag2", email: `ag2-${Date.now()}@t.dev` } });
    await prisma.membership.create({ data: { orgId, userId: agent.id, role: "AGENT", active: true } });
    await prisma.contact.create({
      data: { orgId, name: "Ama K.", phoneE164: "+15551230000", assignedAgentId: agent.id },
    });
    const asService = prisma as unknown as PrismaService;
    const svc = new WhatsappService(
      asService,
      new MetaProvider() as never,
      new NotificationsService(asService),
    );
    await svc.ingest(inbound("wamid.n3", "Hello with working notify"));
    const notes = await prisma.notification.findMany({ where: { orgId, userId: agent.id } });
    expect(notes.length).toBe(1);
    expect(notes[0].kind).toBe("conversation.reply");
  });
});

describe("inbound media reliability (must never sink the message)", () => {
  let prisma: PrismaClient;
  let orgId: string;

  beforeAll(() => {
    prisma = testPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const org = await prisma.organisation.create({ data: { name: "wa-media", slug: `wam-${Date.now()}` } });
    orgId = org.id;
  });

  async function numberWith(token: string) {
    return prisma.whatsappNumber.create({
      data: { orgId, label: "M", providerNumberId: "15550009999", accessToken: token },
    });
  }

  it("persists the message when the number token cannot be decrypted", async () => {
    await numberWith("enc1:AAAA.invalid.ciphertext");
    const svc = stubService(prisma, async () => {
      throw new Error("should never be called without a token");
    });
    await svc.ingest(imageInbound("wamid.m1"));
    const msg = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.m1" } });
    expect(msg.mediaKey).toBeNull();
    const failed = await prisma.activity.findMany({ where: { orgId, type: "conversation.media_failed" } });
    expect(failed.length).toBe(1);
  });

  it("persists the message when media download fails", async () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "test-media-key-0123456789abcdef";
    try {
      const { encryptToken } = await import("../common/crypto");
      await numberWith(encryptToken("valid-provider-token"));
      const svc = stubService(prisma, async () => null);
      await svc.ingest(imageInbound("wamid.m2"));
      const msg = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.m2" } });
      expect(msg.mediaKey).toBeNull();
      const failed = await prisma.activity.findMany({ where: { orgId, type: "conversation.media_failed" } });
      expect(failed.length).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved;
    }
  });

  it("attaches media on the success path", async () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "test-media-key-0123456789abcdef";
    try {
      const { encryptToken } = await import("../common/crypto");
      await numberWith(encryptToken("valid-provider-token"));
      const svc = stubService(prisma, async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }));
      await svc.ingest(imageInbound("wamid.m3"));
      const msg = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.m3" } });
      expect(msg.mediaKey).toBe(`wa/${orgId}/wamid.m3`);
      const attached = await prisma.activity.findMany({ where: { orgId, type: "conversation.media_attached" } });
      expect(attached.length).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved;
    }
  });
});

describe("delivery status receipts (accelerated)", () => {
  let prisma: PrismaClient;
  let orgId: string;
  let convId: string;
  let agentId: string;
  let wa: WhatsappService;

  beforeAll(() => {
    prisma = testPrisma();
    const asService = prisma as unknown as PrismaService;
    wa = new WhatsappService(asService, new MetaProvider() as never, new NotificationsService(asService));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    const org = await prisma.organisation.create({ data: { name: "wa-status", slug: `was-${Date.now()}` } });
    orgId = org.id;
    const agent = await prisma.user.create({ data: { name: "AgS", email: `ags-${Date.now()}@t.dev` } });
    agentId = agent.id;
    await prisma.membership.create({ data: { orgId, userId: agent.id, role: "AGENT", active: true } });
    const contact = await prisma.contact.create({
      data: { orgId, name: "Sam", phoneE164: "+15550001111", assignedAgentId: agent.id },
    });
    const number = await prisma.whatsappNumber.create({
      data: { orgId, label: "N", providerNumberId: "15550009999", accessToken: "test" },
    });
    const conv = await prisma.conversation.create({ data: { orgId, contactId: contact.id, whatsappNumberId: number.id } });
    convId = conv.id;
    await prisma.message.create({
      data: { orgId, conversationId: conv.id, providerMessageId: "wamid.s1", direction: "OUT", type: "text", body: "Hi" },
    });
  });

  it("marks delivered and read", async () => {
    await wa.applyStatuses([{ providerMessageId: "wamid.s1", status: "delivered", timestamp: new Date() }]);
    let m = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.s1" } });
    expect(m.status).toBe("DELIVERED");
    await wa.applyStatuses([{ providerMessageId: "wamid.s1", status: "read", timestamp: new Date() }]);
    m = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.s1" } });
    expect(m.status).toBe("READ");
  });

  it("marks failed with reason, timeline event and assignee notice", async () => {
    await wa.applyStatuses([
      { providerMessageId: "wamid.s1", status: "failed", timestamp: new Date(), errorCode: "131047", errorDetail: "Re-engagement" },
    ]);
    const m = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: "wamid.s1" } });
    expect(m.status).toBe("FAILED");
    expect(m.failureReason).toContain("131047");
    const failed = await prisma.activity.findMany({ where: { orgId, type: "message.failed" } });
    expect(failed.length).toBe(1);
    const notes = await prisma.notification.findMany({ where: { orgId, userId: agentId } });
    expect(notes.some((n) => n.kind === "sequence.attention")).toBe(true);
  });

  it("ignores receipts for unknown messages", async () => {
    await wa.applyStatuses([{ providerMessageId: "wamid.nope", status: "delivered", timestamp: new Date() }]);
    expect(await prisma.message.count({ where: { orgId } })).toBe(1);
  });

  it("surfaces the failed receipt in the conversation thread", async () => {
    await wa.applyStatuses([{ providerMessageId: "wamid.s1", status: "failed", timestamp: new Date() }]);
    const t = await prisma.conversation.findUniqueOrThrow({ where: { id: convId }, include: { messages: true } });
    expect(t.messages[0].status).toBe("FAILED");
  });
});
