import { Injectable, Logger } from "@nestjs/common";
import type { InboundMessage, SendTextResult, WhatsappProvider } from "./provider";
/**
 * Central Meta Graph API version for every endpoint (sends, templates,
 * media, number validation). Configurable via WHATSAPP_API_VERSION, read at
 * call time so process boot, tests and restarts always see the live value.
 * Default is the current version (v26.0 as of Oct 2026) — never a legacy one.
 */
export const DEFAULT_META_API_VERSION = "v26.0";

export function metaApiVersion(): string {
  const v = (process.env.WHATSAPP_API_VERSION ?? "").trim();
  return v || DEFAULT_META_API_VERSION;
}

/**
 * Meta template-message input validation (pure, unit-tested).
 * Template names are lowercase alphanumeric + underscore (Meta convention);
 * language is a BCP-47-ish code like en_US. Fails fast before any network call.
 */
export function validateTemplateInput(opts: { template: string; language?: string; bodyText?: string }): {
  template: string;
  language: string;
  bodyText?: string;
} {
  const template = String(opts.template ?? "").trim();
  if (!/^[a-z0-9_]{1,100}$/.test(template)) {
    throw new Error(
      "Invalid template name — use the exact lowercase name approved in Meta (letters, digits, underscores)",
    );
  }
  const language = (opts.language ?? "en_US").trim();
  if (!/^[a-z]{2,3}_[A-Z]{2}$/.test(language)) {
    throw new Error("Invalid template language — expected a code like en_US");
  }
  if (opts.bodyText !== undefined) {
    if (typeof opts.bodyText !== "string" || opts.bodyText.trim() === "") {
      throw new Error("Template body text must not be empty");
    }
    if (opts.bodyText.length > 1024) {
      throw new Error("Template body text exceeds Meta's 1024-character parameter limit — shorten the message");
    }
  }
  return { template, language, bodyText: opts.bodyText };
}

/** Meta WhatsApp Business Cloud API (direct, no BSP). */
@Injectable()
export class MetaProvider implements WhatsappProvider {
  readonly name = "meta";
  private readonly log = new Logger(MetaProvider.name);

  async sendText(opts: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<SendTextResult> {
    if (process.env.WHATSAPP_DRY_RUN === "1") {
      const id = `dry-run-${Date.now()}`;
      this.log.warn(`DRY RUN send to ${opts.to}: ${opts.body.slice(0, 80)}`);
      return { providerMessageId: id, via: "text" };
    }
    const res = await fetch(`https://graph.facebook.com/${metaApiVersion()}/${opts.phoneNumberId}/messages`, {
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
    return { providerMessageId: id, via: "text" };
  }

  async sendTemplate(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    template: string;
    language?: string;
    bodyText?: string;
  }): Promise<SendTextResult> {
    const {
      template,
      language,
      bodyText,
    } = validateTemplateInput({ template: opts.template, language: opts.language, bodyText: opts.bodyText });
    if (process.env.WHATSAPP_DRY_RUN === "1") {
      const id = `dry-run-${Date.now()}`;
      this.log.warn(`DRY RUN template ${template} to ${opts.to}`);
      return { providerMessageId: id, via: "template" };
    }
    const components =
      bodyText !== undefined
        ? [{ type: "body", parameters: [{ type: "text", text: bodyText }] }]
        : [];
    const res = await fetch(`https://graph.facebook.com/${metaApiVersion()}/${opts.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: opts.to,
        type: "template",
        template: { name: template, language: { code: language }, components },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meta template send failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { messages?: Array<{ id: string }> };
    const id = json.messages?.[0]?.id;
    if (!id) throw new Error("Meta template send returned no message id");
    return { providerMessageId: id, via: "template" };
  }

  /** Text inside the 24h customer-service window, approved template outside it. */
  async sendOutbound(opts: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    body: string;
    contactName: string;
    lastInboundAt?: Date | null;
  }): Promise<SendTextResult> {
    const windowOpen =
      opts.lastInboundAt != null && Date.now() - new Date(opts.lastInboundAt).getTime() < 24 * 3600000;
    const fallback = process.env.WHATSAPP_FALLBACK_TEMPLATE?.trim() || "";
    if (!windowOpen && fallback) {
      this.log.warn(`24h window closed for ${opts.to}, using template ${fallback}`);
      return this.sendTemplate({
        phoneNumberId: opts.phoneNumberId,
        accessToken: opts.accessToken,
        to: opts.to,
        template: fallback,
        bodyText: opts.body,
      });
    }
    if (!windowOpen) {
      // Never silently fall back to an unapproved free-form message: Meta
      // rejects out-of-window text, so fail openly with an actionable error.
      throw new Error(
        "Outside Meta's 24h customer-service window and no approved fallback template is configured " +
          "(WHATSAPP_FALLBACK_TEMPLATE) — wait for the contact to reply or configure a template",
      );
    }
    return this.sendText(opts);
  }

  async fetchMedia(opts: { mediaId: string; accessToken: string }): Promise<{ bytes: Uint8Array; mime: string } | null> {
    try {
      const meta = await fetch(`https://graph.facebook.com/${metaApiVersion()}/${opts.mediaId}`, {
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
        const referral = m.referral ?? m.context?.referral ?? undefined;
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
          referral: referral
            ? {
                sourceUrl: referral.source_url ? String(referral.source_url) : undefined,
                sourceType: referral.source_type ? String(referral.source_type) : undefined,
                ctwaClid: referral.ctwa_clid ? String(referral.ctwa_clid) : undefined,
              }
            : undefined,
        });
      }
    }
  }
  return out;
}

export interface InboundStatus {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed" | "deleted";
  timestamp: Date;
  errorCode?: string;
  errorDetail?: string;
}

/** Delivery/read/failure receipts. Unknown ids are ignored by the caller. */
export function parseMetaStatuses(payload: any): InboundStatus[] {
  const out: InboundStatus[] = [];
  const known = new Set(["sent", "delivered", "read", "failed", "deleted"]);
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (typeof s?.id !== "string" || !known.has(String(s.status))) continue;
        const errors = Array.isArray(s.errors) ? s.errors : [];
        out.push({
          providerMessageId: String(s.id),
          status: String(s.status) as InboundStatus["status"],
          timestamp: new Date(Number(s.timestamp) * 1000),
          errorCode: errors[0]?.code !== undefined ? String(errors[0].code) : undefined,
          errorDetail: errors[0]?.title ? String(errors[0].title).slice(0, 200) : undefined,
        });
      }
    }
  }
  return out;
}
