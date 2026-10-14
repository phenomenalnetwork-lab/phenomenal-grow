import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { encryptToken } from "../common/crypto";
import { DEFAULT_META_API_VERSION, MetaProvider, metaApiVersion } from "./meta.provider";
import { WhatsappService } from "./whatsapp.service";

const realFetch = globalThis.fetch;

function mockFetchOk() {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.v" }] }) };
  }) as any;
  return calls;
}

describe("Meta Graph API version", () => {
  const saved = process.env.WHATSAPP_API_VERSION;

  beforeEach(() => {
    delete process.env.WHATSAPP_API_VERSION;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.WHATSAPP_API_VERSION;
    else process.env.WHATSAPP_API_VERSION = saved;
    globalThis.fetch = realFetch;
  });

  it("defaults to the current version, never a legacy one", () => {
    expect(metaApiVersion()).toBe("v26.0");
    expect(DEFAULT_META_API_VERSION).toBe("v26.0");
    expect(Number(DEFAULT_META_API_VERSION.slice(1))).toBeGreaterThanOrEqual(20);
  });

  it("falls back to the default on empty/blank configuration", () => {
    process.env.WHATSAPP_API_VERSION = "   ";
    expect(metaApiVersion()).toBe(DEFAULT_META_API_VERSION);
  });

  it("honours an explicit configured version", () => {
    process.env.WHATSAPP_API_VERSION = "v25.0";
    expect(metaApiVersion()).toBe("v25.0");
  });

  it("builds send URLs with the configured version", async () => {
    const urls = mockFetchOk();
    const p = new MetaProvider();
    await p.sendText({ phoneNumberId: "1555", accessToken: "t", to: "+1000", body: "Hi" });
    expect(urls[0]).toBe("https://graph.facebook.com/v26.0/1555/messages");

    process.env.WHATSAPP_API_VERSION = "v25.0";
    await p.sendTemplate({ phoneNumberId: "1555", accessToken: "t", to: "+1000", template: "hello_world" });
    expect(urls[1]).toBe("https://graph.facebook.com/v25.0/1555/messages");
  });

  it("builds the Test-connection validation URL with the same version", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef";
    const urls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ id: "1555", display_phone_number: "+1 555" }) };
    }) as any;
    const prisma: any = {
      whatsappNumber: {
        findFirst: async () => ({ id: "n1", orgId: "org-a", providerNumberId: "1555", accessToken: encryptToken("test-access-token-0123456789") }),
        update: async () => ({}),
      },
    };
    const svc = new WhatsappService(prisma, {} as any, { notify: async () => undefined, notifyOwners: async () => undefined } as any);
    const out: any = await svc.testNumber({ orgId: "org-a", userId: "u1", role: "OWNER" }, "n1");
    expect(out.ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("https://graph.facebook.com/v26.0/1555");
    delete process.env.ENCRYPTION_KEY;
  });

  it("builds the media lookup URL with the same version", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      urls.push(String(url));
      if (String(url).includes("graph.facebook.com")) {
        return { ok: true, json: async () => ({ url: "https://dl/x", mime_type: "image/jpeg" }) };
      }
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(3) };
    }) as any;
    const p = new MetaProvider();
    const media = await p.fetchMedia({ mediaId: "media-1", accessToken: "t" });
    expect(urls[0]).toBe("https://graph.facebook.com/v26.0/media-1");
    expect(media?.mime).toBe("image/jpeg");
  });
});
