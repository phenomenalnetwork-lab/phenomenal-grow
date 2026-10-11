import { Injectable, Logger } from "@nestjs/common";
import type { InboundMessage, SendTextResult, WhatsappProvider } from "./provider";

const API_VERSION = process.env.WHATSAPP_API_VERSION ?? "v23.0";

/** Meta WhatsApp Business Cloud API (direct, no BSP). */
@Injectable()
export class MetaProvider implements WhatsappProvider {
  readonly name = "meta";
  private readonly log = new Logger(MetaProvider.name);

  async sendText(opts: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<SendTextResult> {
    if (process.env.WHATSAPP_DRY_RUN === "1") {
      const id = `dry-run-${Date.now()}`;
      this.log.warn(`DRY RUN send to ${opts.to}: ${opts.body.slice(0, 80)}`);
      return { providerMessageId: id };
    }
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: opts.to, type: "text", text: { body: opts.body } }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meta send failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { messages?: Array<{ id: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error("Meta send returned no message id");
    return { providerMessageId: id };
  }

  async fetchMedia(opts: { mediaId: string; accessToken: string }): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      const meta = await fetch(`https://graph.facebook.com/${API_VERSION}/${opts.mediaId}`, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
      });
      if (!meta.ok) return null;
      const info = (await meta.json()) as { url?: string; mime_type?: string };
      if (!info.url) return null;
      const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${opts.accessToken}` } });
      if (!bin.ok) return null;
      return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: info.mime_type ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
}

/** Parse a Meta webhook payload into normalized inbound messages. */
export function parseMetaPayload(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value?.messages) continue;
      const phoneNumberId = String(value?.metadata?.phone_number_id ?? "");
      const contacts: Record<string, string> = {};
      for (const c of value?.contacts ?? []) contacts[String(c.wa_id)] = String(c.profile?.name ?? "");
      for (const m of value.messages) {
        out.push({
          providerMessageId: String(m.id),
          from: String(m.from),
          profileName: contacts[String(m.from)] || undefined,
          phoneNumberId,
          timestamp: new Date(Number(m.timestamp) * 1000),
          type: String(m.type ?? "text"),
          text: m.text?.body ? String(m.text.body) : undefined,
          mediaId: m[m.type]?.id ? String(m[m.type].id) : undefined,
          mediaMime: m[m.type]?.mime_type ? String(m[m.type].mime_type) : undefined,
        });
      }
    }
  }
  return out;
}
