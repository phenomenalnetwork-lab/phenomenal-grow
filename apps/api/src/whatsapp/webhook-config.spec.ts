import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { encryptToken } from "../common/crypto";
import { checkTenantScope, verifyTokenMatches } from "./webhook-verify";
import { validateWebhookConfigInput, WhatsappService } from "./whatsapp.service";

const KEY = "test-encryption-key-0123456789abcdef";

function ownerCtx(orgId: string) {
  return { orgId, userId: "owner-1", role: "OWNER" as const };
}
function agentCtx(orgId: string) {
  return { orgId, userId: "agent-1", role: "AGENT" as const };
}

function stubService(stores: {
  config?: any;
  numbers?: Record<string, any>;
  convCounts?: Record<string, number>;
  calls?: { upserts: any[]; updates: any[]; deletes: string[]; numberUpdates: any[] };
}) {
  const calls = stores.calls ?? { upserts: [], updates: [], deletes: [], numberUpdates: [] };
  const prisma: any = {
    whatsappConfig: {
      findUnique: async (_args: any) => stores.config ?? null,
      upsert: undefined,
      create: async ({ data }: any) => {
        calls.upserts.push({ op: "create", data });
        stores.config = { ...data, id: "cfg-1", updatedAt: new Date() };
        return stores.config;
      },
      update: async ({ data }: any) => {
        calls.updates.push({ op: "update", data });
        stores.config = { ...stores.config, ...data, updatedAt: new Date() };
        return stores.config;
      },
    },
    whatsappNumber: {
      findFirst: async (/* _args */ _args: any) => {
        return stores.numbers?.["n1"] ?? null;
      },
      update: async ({ where, data }: any) => {
        calls.numberUpdates.push({ where, data });
        return { id: where.id, ...data };
      },
      delete: async ({ where }: any) => {
        calls.deletes.push(where.id);
        return { id: where.id };
      },
    },
    conversation: {
      count: async ({ where }: any) => {
        const key = where.whatsappNumberId + (where.status ? `:open` : ":all");
        void key;
        return where.status ? (stores.convCounts?.open ?? 0) : (stores.convCounts?.all ?? 0);
      },
    },
  };
  const svc = new WhatsappService(prisma, {} as any, { notify: async () => undefined, notifyOwners: async () => undefined } as any);
  return { svc, calls, prisma };
}

describe("per-org webhook verification", () => {
  const savedKey = process.env.ENCRYPTION_KEY;
  const savedDry = process.env.WHATSAPP_DRY_RUN;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
    if (savedDry === undefined) delete process.env.WHATSAPP_DRY_RUN;
    else process.env.WHATSAPP_DRY_RUN = savedDry;
  });

  it("matches the exact token only", () => {
    expect(verifyTokenMatches("abc12345", "abc12345")).toBe(true);
    expect(verifyTokenMatches("abc12345", "abc12346")).toBe(false);
    expect(verifyTokenMatches("", "abc12345")).toBe(false);
    expect(verifyTokenMatches("abc12345", "")).toBe(false);
    expect(verifyTokenMatches(undefined, "abc12345")).toBe(false);
  });

  it("isolates tenants by org", () => {
    expect(checkTenantScope("org-a", "org-a")).toBe(true);
    expect(checkTenantScope("org-a", "org-b")).toBe(false);
    expect(checkTenantScope("", "org-b")).toBe(false);
  });

  it("validates config input, blank means keep", () => {
    expect(validateWebhookConfigInput({ verifyToken: "my-random-token-1", appSecret: "0123456789abcdef0123456789abcdef" })).toEqual({
      verifyToken: "my-random-token-1",
      appSecret: "0123456789abcdef0123456789abcdef",
    });
    expect(() => validateWebhookConfigInput({ verifyToken: "", appSecret: "" })).toThrow();
    expect(() => validateWebhookConfigInput({})).toThrow();
    expect(() => validateWebhookConfigInput({ verifyToken: "short" })).toThrow();
    expect(() => validateWebhookConfigInput({ appSecret: "tiny" })).toThrow();
  });

  it("verifies the correct token, rejects wrong and missing config", async () => {
    const { svc } = stubService({ config: { orgId: "org-a", verifyToken: encryptToken("correct-token-1"), appSecret: null } });
    expect(await svc.checkOrgVerifyToken("org-a", "correct-token-1")).toBe(true);
    expect(await svc.checkOrgVerifyToken("org-a", "wrong-token-xyz")).toBe(false);
    const { svc: noCfg } = stubService({});
    expect(await noCfg.checkOrgVerifyToken("org-a", "correct-token-1")).toBe(false);
  });

  it("rotates the token: old stops working, new works", async () => {
    const stores: any = { config: { orgId: "org-a", verifyToken: encryptToken("old-token-111"), appSecret: null } };
    const { svc } = stubService(stores);
    expect(await svc.checkOrgVerifyToken("org-a", "old-token-111")).toBe(true);
    await svc.putConfig(ownerCtx("org-a"), { verifyToken: "new-token-222" });
    expect(await svc.checkOrgVerifyToken("org-a", "old-token-111")).toBe(false);
    expect(await svc.checkOrgVerifyToken("org-a", "new-token-222")).toBe(true);
  });

  it("never returns secrets from get/put", async () => {
    const { svc } = stubService({
      config: { orgId: "org-a", verifyToken: encryptToken("tok"), appSecret: encryptToken("sec"), updatedAt: new Date() },
    });
    for (const out of [await svc.getConfig(ownerCtx("org-a")), await svc.putConfig(ownerCtx("org-a"), { verifyToken: "rotated-token-9" })]) {
      const text = JSON.stringify(out);
      expect(text).not.toContain("tok");
      expect(text).not.toContain("sec");
      expect(text).not.toContain("rotated-token-9");
      expect(text).not.toContain("enc1:");
    }
  });

  it("stores ciphertext only (fail-closed, no plaintext)", async () => {
    const { svc, calls } = stubService({});
    await svc.putConfig(ownerCtx("org-a"), { verifyToken: "brand-new-token-3" });
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].data.verifyToken.startsWith("enc1:")).toBe(true);
  });

  it("blank token preserves the stored ciphertext", async () => {
    const stored = encryptToken("keep-me-token-4");
    const { svc, calls } = stubService({ config: { orgId: "org-a", verifyToken: stored, appSecret: null } });
    await svc.putConfig(ownerCtx("org-a"), { verifyToken: "", appSecret: "fedcba9876543210fedcba9876543210" });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].data.verifyToken).toBeUndefined();
    expect(calls.updates[0].data.appSecret.startsWith("enc1:")).toBe(true);
  });

  it("rejects non-owners on every endpoint", async () => {
    const { svc } = stubService({ config: { orgId: "org-a", verifyToken: encryptToken("tok"), appSecret: null } });
    await expect(svc.getConfig(agentCtx("org-a"))).rejects.toThrow();
    await expect(svc.putConfig(agentCtx("org-a"), { verifyToken: "another-token-5" })).rejects.toThrow();
  });

  it("blocks disconnect while any history exists (open or closed)", async () => {
    const numbers = { n1: { id: "n1", orgId: "org-a", providerNumberId: "1555", accessToken: encryptToken("a".repeat(20)) } };
    const blocked = stubService({ numbers, convCounts: { all: 2, open: 0 } });
    await expect(blocked.svc.removeNumber(ownerCtx("org-a"), "n1")).rejects.toThrow(/history/);
    expect(blocked.calls.deletes).toHaveLength(0);

    const open = stubService({ numbers, convCounts: { all: 3, open: 1 } });
    await expect(open.svc.removeNumber(ownerCtx("org-a"), "n1")).rejects.toThrow(/open/i);
    expect(open.calls.deletes).toHaveLength(0);

    const clean = stubService({ numbers, convCounts: { all: 0, open: 0 } });
    await expect(clean.svc.removeNumber(ownerCtx("org-a"), "n1")).resolves.toEqual({ ok: true });
    expect(clean.calls.deletes).toEqual(["n1"]);
  });

  it("persists test proof without leaking the token", async () => {
    process.env.WHATSAPP_DRY_RUN = "1";
    const numbers = { n1: { id: "n1", orgId: "org-a", providerNumberId: "1555", accessToken: encryptToken("a".repeat(20)) } };
    const { svc, calls } = stubService({ numbers });
    const out: any = await svc.testNumber(ownerCtx("org-a"), "n1");
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).not.toContain("enc1:");
    expect(calls.numberUpdates).toHaveLength(1);
    expect(calls.numberUpdates[0].data.lastTestOk).toBe(true);
    expect(calls.numberUpdates[0].data.lastTestedAt).toBeInstanceOf(Date);
  });
});
