import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MetaProvider } from "./meta.provider";

const BASE = {
  phoneNumberId: "15550009999",
  accessToken: "test",
  to: "+15551230000",
  body: "Hello",
  contactName: "Ama",
};

describe("sendOutbound window selection (dry-run)", () => {
  const savedDry = process.env.WHATSAPP_DRY_RUN;
  const savedTpl = process.env.WHATSAPP_FALLBACK_TEMPLATE;

  beforeEach(() => {
    process.env.WHATSAPP_DRY_RUN = "1";
    delete process.env.WHATSAPP_FALLBACK_TEMPLATE;
  });

  afterEach(() => {
    if (savedDry === undefined) delete process.env.WHATSAPP_DRY_RUN;
    else process.env.WHATSAPP_DRY_RUN = savedDry;
    if (savedTpl === undefined) delete process.env.WHATSAPP_FALLBACK_TEMPLATE;
    else process.env.WHATSAPP_FALLBACK_TEMPLATE = savedTpl;
  });

  it("sends text inside the 24h window", async () => {
    const p = new MetaProvider();
    const r = await p.sendOutbound({ ...BASE, lastInboundAt: new Date() });
    expect(r.via).toBe("text");
  });

  it("fails openly outside the window when no fallback template is configured", async () => {
    const p = new MetaProvider();
    await expect(
      p.sendOutbound({ ...BASE, lastInboundAt: new Date(Date.now() - 48 * 3600000) }),
    ).rejects.toThrow(/24h customer-service window/);
  });

  it("uses the fallback template outside the window when configured", async () => {
    process.env.WHATSAPP_FALLBACK_TEMPLATE = "hello_world";
    const p = new MetaProvider();
    const r = await p.sendOutbound({ ...BASE, lastInboundAt: new Date(Date.now() - 48 * 3600000) });
    expect(r.via).toBe("template");
  });

  it("treats missing inbound history as closed window", async () => {
    process.env.WHATSAPP_FALLBACK_TEMPLATE = "hello_world";
    const p = new MetaProvider();
    const r = await p.sendOutbound({ ...BASE, lastInboundAt: null });
    expect(r.via).toBe("template");
  });
});
