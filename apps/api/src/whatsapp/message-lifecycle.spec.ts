import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { encryptToken } from "../common/crypto";
import { MetaProvider, validateTemplateInput } from "./meta.provider";
import { checkSignature } from "./webhook-verify";
import { failureHint, WhatsappService } from "./whatsapp.service";

vi.mock("@pgrow/storage", () => ({ putObject: vi.fn() }));
import { putObject } from "@pgrow/storage";

const KEY = "test-encryption-key-0123456789abcdef";
const putMock = putObject as unknown as ReturnType<typeof vi.fn>;

// -- stub database -----------------------------------------------------------

type StoredMsg = {
  id: string;
  orgId: string;
  conversationId: string;
  providerMessageId: string;
  direction: "IN" | "OUT";
  status: string;
  statusAt?: Date;
  failureReason?: string | null;
  mediaKey?: string | null;
  mediaMime?: string | null;
  conversation: { contactId: string; assignedAgentId: string | null };
};

function stubService(stores: {
  messages?: Record<string, StoredMsg>;
  contacts?: Record<string, { id: string; name: string; assignedAgentId: string | null }>;
  conv?: any;
  contactRow?: any;
}) {
  const calls = { updates: [] as any[], activities: [] as any[], notifies: [] as any[], creates: [] as any[] };
  const tx: any = {
    message: {
      update: async ({ where, data }: any) => {
        calls.updates.push({ where, data });
        const m = Object.values(stores.messages ?? {}).find((x) => x.id === where.id);
        if (m) Object.assign(m, data);
        return m;
      },
      create: async ({ data }: any) => {
        calls.creates.push(data);
        return { id: `m-${calls.creates.length}`, ...data };
      },
    },
    contact: { findUnique: async () => stores.contacts?.["c1"] ?? null },
    activity: { create: async ({ data }: any) => void calls.activities.push(data) },
    conversation: { update: async () => ({}), create: async () => ({ id: "conv-new" }) },
  };
  const prisma: any = {
    message: {
      findUnique: async ({ where }: any) => stores.messages?.[where.providerMessageId] ?? null,
      findFirst: async ({ where }: any) => {
        const row = (stores as any).existing ?? null;
        if (!row) return null;
        if (where?.orgId && row.orgId !== where.orgId) return null;
        return row;
      },
    },
    activity: { create: async ({ data }: any) => void calls.activities.push(data) },
    conversation: {
      findFirst: async () => stores.conv ?? null,
      findUnique: async () => ({ contactId: "c1" }),
      count: async () => 0,
      update: async () => ({}),
    },
    contact: { findUniqueOrThrow: async () => stores.contactRow },
    whatsappNumber: { findFirst: async () => (stores as any).number ?? null },
    $transaction: async (fn: any) => fn(tx),
  };
  const notify: any = { notify: async (n: any) => void calls.notifies.push(n), notifyOwners: async () => undefined };
  const svc = new WhatsappService(prisma, {} as any, notify);
  return { svc, calls };
}

function outMsg(partial: Partial<StoredMsg> = {}): StoredMsg {
  return {
    id: "m1",
    orgId: "org-a",
    conversationId: "conv-1",
    providerMessageId: "wamid.1",
    direction: "OUT",
    status: "SENT",
    conversation: { contactId: "c1", assignedAgentId: "agent-1" },
    ...partial,
  };
}

const STATUS = (providerMessageId: string, status: string, extra: Record<string, unknown> = {}) => ({
  providerMessageId,
  status,
  timestamp: new Date(),
  ...extra,
});

// -- specs -------------------------------------------------------------------

describe("delivery status lifecycle", () => {
  it("advances sent → delivered → read", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg() } });
    expect(await svc.applyStatuses([STATUS("wamid.1", "sent")])).toMatchObject({ updated: 0, skipped: 1 });
    expect(await svc.applyStatuses([STATUS("wamid.1", "delivered")])).toMatchObject({ updated: 1 });
    expect(await svc.applyStatuses([STATUS("wamid.1", "read")])).toMatchObject({ updated: 1 });
    expect(calls.updates.map((u: any) => u.data.status)).toEqual(["DELIVERED", "READ"]);
  });

  it("ignores stale out-of-order events (regression: late delivered after read)", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg({ status: "READ" }) } });
    const r = await svc.applyStatuses([STATUS("wamid.1", "delivered")]);
    expect(r).toMatchObject({ updated: 0, skipped: 1 });
    expect(calls.updates).toHaveLength(0);
  });

  it("applies read-then-failed and preserves failure codes", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg({ status: "READ" }) } });
    const r = await svc.applyStatuses([
      STATUS("wamid.1", "failed", { errorCode: "131047", errorDetail: "Re-engagement" }),
    ]);
    // FAILED is terminal but not a delivery stage: it records even after READ,
    // carrying the provider code and an actionable hint.
    expect(r).toMatchObject({ updated: 1 });
    expect(calls.updates[0].data.status).toBe("FAILED");
    expect(calls.updates[0].data.failureReason).toContain("131047");
    expect(calls.updates[0].data.failureReason).toContain("24h window");
    expect(calls.activities.filter((a: any) => a.type === "message.failed")).toHaveLength(1);
  });

  it("holds failed-then-delivered: FAILED is terminal, not a delivery stage", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg({ status: "FAILED", failureReason: "1 boom" }) } });
    const r = await svc.applyStatuses([STATUS("wamid.1", "delivered"), STATUS("wamid.1", "read")]);
    expect(r).toMatchObject({ updated: 0, skipped: 2 });
    expect(calls.updates).toHaveLength(0);
  });

  it("ignores stale sent after delivered", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg({ status: "DELIVERED" }) } });
    expect(await svc.applyStatuses([STATUS("wamid.1", "sent")])).toMatchObject({ updated: 0, skipped: 1 });
    expect(calls.updates).toHaveLength(0);
  });

  it("is idempotent on duplicates: one write, one failure notice", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg() } });
    await svc.applyStatuses([STATUS("wamid.1", "delivered")]);
    await svc.applyStatuses([STATUS("wamid.1", "delivered")]);
    expect(calls.updates).toHaveLength(1);
    await svc.applyStatuses([STATUS("wamid.1", "failed", { errorCode: "1", errorDetail: "x" })]);
    await svc.applyStatuses([STATUS("wamid.1", "failed", { errorCode: "1", errorDetail: "x" })]);
    expect(calls.activities.filter((a: any) => a.type === "message.failed")).toHaveLength(1);
    expect(calls.notifies).toHaveLength(1);
  });

  it("ignores unknown ids and inbound messages", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg() } });
    const r = await svc.applyStatuses([
      STATUS("wamid.nope", "delivered"),
      { providerMessageId: "wamid.1", status: "read", timestamp: new Date() },
    ]);
    expect(r).toMatchObject({ ignored: 1, updated: 1 });
    expect(calls.updates).toHaveLength(1);
    const { svc: svc2, calls: calls2 } = stubService({
      messages: { "wamid.2": outMsg({ id: "m2", providerMessageId: "wamid.2", direction: "IN" }) },
    });
    expect(await svc2.applyStatuses([STATUS("wamid.2", "delivered")])).toMatchObject({ ignored: 1 });
    expect(calls2.updates).toHaveLength(0);
  });

  it("persists failure codes with actionable hints, no credentials", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg() } });
    await svc.applyStatuses([STATUS("wamid.1", "failed", { errorCode: "131047", errorDetail: "Re-engagement" })]);
    const data = calls.updates[0].data;
    expect(data.status).toBe("FAILED");
    expect(data.failureReason).toContain("131047");
    expect(data.failureReason).toContain("24h window");
    const blob = JSON.stringify(calls);
    expect(blob).not.toContain("enc1:");
    expect(failureHint("131047")).toContain("24h window");
    expect(failureHint("131026")).toContain("recipient");
    expect(failureHint("999999")).toBeNull();
  });

  it("enforces tenant isolation on the per-org path", async () => {
    const { svc, calls } = stubService({ messages: { "wamid.1": outMsg({ orgId: "org-a" }) } });
    const r = await svc.applyStatuses([STATUS("wamid.1", "delivered")], { expectedOrgId: "org-b" });
    expect(r).toMatchObject({ skipped: 1, updated: 0 });
    expect(calls.updates).toHaveLength(0);
    const ok = await svc.applyStatuses([STATUS("wamid.1", "delivered")], { expectedOrgId: "org-a" });
    expect(ok).toMatchObject({ updated: 1 });
  });
});

describe("template send path", () => {
  const savedDry = process.env.WHATSAPP_DRY_RUN;
  const savedTpl = process.env.WHATSAPP_FALLBACK_TEMPLATE;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.WHATSAPP_DRY_RUN;
    delete process.env.WHATSAPP_FALLBACK_TEMPLATE;
  });
  afterEach(() => {
    if (savedDry === undefined) delete process.env.WHATSAPP_DRY_RUN;
    else process.env.WHATSAPP_DRY_RUN = savedDry;
    if (savedTpl === undefined) delete process.env.WHATSAPP_FALLBACK_TEMPLATE;
    else process.env.WHATSAPP_FALLBACK_TEMPLATE = savedTpl;
    globalThis.fetch = realFetch;
  });

  it("validates name, language and parameters", () => {
    expect(validateTemplateInput({ template: "hello_world" })).toMatchObject({ template: "hello_world", language: "en_US" });
    expect(validateTemplateInput({ template: "order_update_2", language: "de_DE", bodyText: "Hi" }).language).toBe("de_DE");
    expect(() => validateTemplateInput({ template: "" })).toThrow(/template name/i);
    expect(() => validateTemplateInput({ template: "Hello World!" })).toThrow(/template name/i);
    expect(() => validateTemplateInput({ template: "ok", language: "english" })).toThrow(/language/i);
    expect(() => validateTemplateInput({ template: "ok", bodyText: "" })).toThrow(/must not be empty/i);
    expect(() => validateTemplateInput({ template: "ok", bodyText: "x".repeat(1025) })).toThrow(/1024/);
  });

  it("rejects invalid templates before any network call", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ messages: [{ id: "wamid.t" }] }) }));
    globalThis.fetch = fetchMock as any;
    const p = new MetaProvider();
    await expect(p.sendTemplate({ phoneNumberId: "1", accessToken: "t", to: "+1000", template: "Bad Name!" })).rejects.toThrow(
      /template name/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a template on mocked provider success (no real messages)", async () => {
    let sentBody: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      sentBody = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ messages: [{ id: "wamid.t1" }] }) };
    }) as any;
    const p = new MetaProvider();
    const r = await p.sendTemplate({ phoneNumberId: "1555", accessToken: "tok", to: "+1000", template: "hello_world", bodyText: "Hi Ama" });
    expect(r).toEqual({ providerMessageId: "wamid.t1", via: "template" });
    expect(sentBody.type).toBe("template");
    expect(sentBody.template.name).toBe("hello_world");
    expect(sentBody.template.language.code).toBe("en_US");
    expect(sentBody.template.components[0].parameters[0].text).toBe("Hi Ama");
  });

  it("surfaces provider rejection as an actionable error", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 400, text: async () => "template not approved" })) as any;
    const p = new MetaProvider();
    await expect(
      p.sendTemplate({ phoneNumberId: "1555", accessToken: "tok", to: "+1000", template: "hello_world" }),
    ).rejects.toThrow(/template send failed \(400\)/);
  });

  it("fails openly outside the window without a fallback (never silent free-form)", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const p = new MetaProvider();
    await expect(
      p.sendOutbound({
        phoneNumberId: "1",
        accessToken: "t",
        to: "+1000",
        body: "Hi",
        contactName: "A",
        lastInboundAt: new Date(Date.now() - 48 * 3600000),
      }),
    ).rejects.toThrow(/24h customer-service window/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("media reliability", () => {
  const savedKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
    putMock.mockReset();
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  function mediaStores(mediaKey: string | null = null, orgId = "org-a") {
    return {
      existing: { id: "m9", orgId, conversationId: "conv-1", mediaKey },
      number: { providerNumberId: "1555", accessToken: encryptToken("test-access-token-0123456789") },
    } as any;
  }

  it("keeps the message and audits when the download fails", async () => {
    const { svc, calls } = stubService(mediaStores());
    (svc as any).provider = { fetchMedia: async () => null };
    expect(await svc.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: false });
    expect(putMock).not.toHaveBeenCalled();
    expect(calls.activities.some((a: any) => a.type === "conversation.media_failed")).toBe(true);
  });

  it("keeps the message when storage is unavailable (R2 creds missing)", async () => {
    const { svc, calls } = stubService(mediaStores());
    (svc as any).provider = { fetchMedia: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }) };
    putMock.mockRejectedValueOnce(new Error("Missing env R2_ACCOUNT_ID (see .env.example)"));
    expect(await svc.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: false });
    expect(calls.activities.some((a: any) => a.type === "conversation.media_failed")).toBe(true);
  });

  it("attaches on the happy path and skips already-attached rows", async () => {
    const { svc, calls } = stubService(mediaStores());
    (svc as any).provider = { fetchMedia: async () => ({ bytes: new Uint8Array([1]), mime: "image/jpeg" }) };
    putMock.mockResolvedValueOnce("wa/org-a/wamid.m");
    expect(await svc.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: true });
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(calls.activities.some((a: any) => a.type === "conversation.media_attached")).toBe(true);

    const { svc: svc2 } = stubService(mediaStores("wa/org-a/wamid.m"));
    let fetched = false;
    (svc2 as any).provider = { fetchMedia: async () => ((fetched = true), null) };
    expect(await svc2.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: true });
    expect(fetched).toBe(false);
  });

  it("rejects oversized attachments without storing", async () => {
    const { svc, calls } = stubService(mediaStores());
    (svc as any).provider = { fetchMedia: async () => ({ bytes: new Uint8Array(33 * 1024 * 1024), mime: "video/mp4" }) };
    expect(await svc.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: false });
    expect(putMock).not.toHaveBeenCalled();
    const failed = calls.activities.find((a: any) => a.type === "conversation.media_failed");
    expect(failed).toBeDefined();
    expect(String((failed as any).payload?.reason ?? "")).toContain("too large");
  });

  it("never touches another tenant's message", async () => {
    const { svc } = stubService(mediaStores(null, "org-b"));
    let fetched = false;
    (svc as any).provider = { fetchMedia: async () => ((fetched = true), null) };
    expect(await svc.attachMedia("org-a", "m9", { mediaId: "media-1", providerMessageId: "wamid.m", providerNumberId: "1555" })).toEqual({ attached: false });
    expect(fetched).toBe(false);
    expect(putMock).not.toHaveBeenCalled();
  });
});

describe("webhook routing and tenant safety", () => {
  it("verifies signatures fail-closed", () => {
    const raw = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
    expect(checkSignature("s3cret", raw, sig)).toBe(true);
    expect(checkSignature("s3cret", raw, "sha256=deadbeef")).toBe(false);
    expect(checkSignature("s3cret", raw, undefined)).toBe(false);
    expect(checkSignature("", raw, sig)).toBe(false);
  });

  it("keeps legacy and tenant paths parse-compatible", async () => {
    const { parseMetaPayload, parseMetaStatuses } = await import("./meta.provider");
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1555" },
                messages: [{ from: "1000", id: "wamid.5", timestamp: "1790000000", type: "text", text: { body: "Hi" } }],
                statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1790000001" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseMetaPayload(payload)).toHaveLength(1);
    expect(parseMetaStatuses(payload)).toHaveLength(1);
  });
});

describe("manual reply failure persistence", () => {
  const savedKey = process.env.ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  it("stores a FAILED row and timeline event, then rethrows", async () => {
    const conv = {
      id: "conv-1",
      orgId: "org-a",
      contactId: "c1",
      status: "OPEN",
      lastInboundAt: new Date(),
      number: { providerNumberId: "1555", accessToken: encryptToken("test-access-token-0123456789") },
    };
    const { svc, calls } = stubService({
      conv,
      contactRow: { id: "c1", orgId: "org-a", name: "Ama", phoneE164: "+1000", status: "ACTIVE", assignedAgentId: null },
    } as any);
    (svc as any).provider = {
      sendOutbound: async () => {
        throw new Error("Meta send failed (400): template not approved");
      },
    };
    await expect(svc.reply({ orgId: "org-a", userId: "u1", role: "OWNER" }, "conv-1", "Hello")).rejects.toThrow(/template not approved/);
    expect(calls.creates).toHaveLength(1);
    expect(calls.creates[0].status).toBe("FAILED");
    expect(calls.creates[0].failureReason).toContain("template not approved");
    expect(calls.creates[0].direction).toBe("OUT");
    expect(calls.activities.some((a: any) => a.type === "message.failed")).toBe(true);
  });
});
