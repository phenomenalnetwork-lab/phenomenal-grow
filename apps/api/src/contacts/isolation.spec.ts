import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContactsService, type ActorCtx } from "./contacts.service";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { testPrisma, truncateAll, makeOrg } from "../test-helpers";

describe("organisation isolation (contacts)", () => {
  let prisma: PrismaClient;
  let svc: ContactsService;

  beforeAll(() => {
    prisma = testPrisma();
    const asService = prisma as unknown as PrismaService;
    svc = new ContactsService(asService, new NotificationsService(asService));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  async function seed() {
    const a = await makeOrg(prisma, "alpha", "OWNER");
    const b = await makeOrg(prisma, "beta", "OWNER");
    const agentA = await prisma.user.create({ data: { name: "agent-a", email: `agenta-${Date.now()}@t.dev` } });
    await prisma.membership.create({ data: { orgId: a.org.id, userId: agentA.id, role: "AGENT", active: true } });
    const ca = await prisma.contact.create({ data: { orgId: a.org.id, name: "Alpha One", phoneE164: "+10000000001", assignedAgentId: agentA.id } });
    await prisma.contact.create({ data: { orgId: b.org.id, name: "Beta One", phoneE164: "+10000000001" } });
    return { a, b, agentA, ca };
  }

  function ctx(orgId: string, userId: string, role: "OWNER" | "AGENT"): ActorCtx {
    return { orgId, userId, role };
  }

  it("owner lists only their own org contacts", async () => {
    const { a, b } = await seed();
    const la = await svc.list(ctx(a.org.id, a.user.id, "OWNER"), {});
    const lb = await svc.list(ctx(b.org.id, b.user.id, "OWNER"), {});
    expect(la.items.map((c) => c.name)).toEqual(["Alpha One"]);
    expect(lb.items.map((c) => c.name)).toEqual(["Beta One"]);
  });

  it("agent sees only assigned contacts, never another org", async () => {
    const { a, b, agentA } = await seed();
    await prisma.contact.create({ data: { orgId: a.org.id, name: "Alpha Two", phoneE164: "+10000000002" } });
    const mine = await svc.list(ctx(a.org.id, agentA.id, "AGENT"), {});
    expect(mine.items.map((c) => c.name)).toEqual(["Alpha One"]);
    const betaContact = await prisma.contact.findFirstOrThrow({ where: { orgId: b.org.id } });
    await expect(svc.get(ctx(a.org.id, agentA.id, "AGENT"), betaContact.id)).rejects.toThrow();
  });

  it("same phone in two orgs are independent records", async () => {
    const { a, b } = await seed();
    await prisma.contact.create({ data: { orgId: b.org.id, name: "Beta Unique", phoneE164: "+10000000009" } });
    const created = await svc.create(ctx(a.org.id, a.user.id, "OWNER"), { name: "Alpha Same-Phone", phone: "+10000000009" });
    expect(created!.phoneE164).toBe("+10000000009");
    expect(created!.orgId).toBe(a.org.id);
  });
});
