import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { decryptToken, encryptToken } from "../common/crypto";
import { logActivity } from "../contacts/activity";
import { normalizePhone } from "../contacts/phone.util";
import type { ActorCtx } from "../contacts/contacts.service";
import { assertVisible } from "../contacts/contacts.service";
import type { InboundMessage, WhatsappProvider } from "./provider";
import { MetaProvider, metaApiVersion } from "./meta.provider";
import { checkTenantScope, verifyTokenMatches } from "./webhook-verify";

function waidToE164(waId: string): string {
  return normalizePhone(`+${waId.replace(/\D/g, "")}`);
}

/** Upper bound for a single inbound attachment held in memory/stored. */
export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;

/**
 * Manual Meta settings input validation (pure, unit-tested).
 * Meta Phone Number IDs and WABA IDs are numeric; tokens are long opaque strings.
 */
export function validateNumberInput(
  dto: any,
  opts?: { allowSameId?: string },
): { label: string; providerNumberId: string; accessToken: string; businessAccountId: string | null } {
  const label = String(dto?.label ?? "").trim().slice(0, 80);
  const providerNumberId = String(dto?.providerNumberId ?? "").trim();
  const accessToken = String(dto?.accessToken ?? "").trim();
  const businessAccountId = String(dto?.businessAccountId ?? "").trim() || null;
  if (!label) throw new ForbiddenException("Label is required");
  if (!/^\d{5,20}$/.test(providerNumberId)) {
    throw new ForbiddenException("Phone Number ID must be 5–20 digits (copy it from Meta → WhatsApp → API Setup)");
  }
  if (!accessToken || accessToken.length < 20) {
    throw new ForbiddenException("A valid Meta access token is required (paste the permanent token from Meta)");
  }
  if (businessAccountId !== null && !/^\d{5,25}$/.test(businessAccountId)) {
    throw new ForbiddenException("Business Account ID must be numeric when provided");
  }
  if (opts?.allowSameId !== undefined && providerNumberId !== opts.allowSameId) {
    // Caller enforces re-auth on ID change; validation just documents the rule.
  }
  return { label, providerNumberId, accessToken, businessAccountId };
}

/**
 * Per-org webhook credential validation (pure, unit-tested).
 * Empty/undefined = keep the stored value (rotation only replaces on input).
 * No plaintext fallbacks: values are always encrypted before storage.
 */
export function validateWebhookConfigInput(dto: any): { verifyToken: string | undefined; appSecret: string | undefined } {
  const rawVerify = dto?.verifyToken === undefined ? undefined : String(dto.verifyToken).trim();
  const rawSecret = dto?.appSecret === undefined ? undefined : String(dto.appSecret).trim();
  let verifyToken: string | undefined;
  let appSecret: string | undefined;
  if (rawVerify !== undefined && rawVerify !== "") {
    if (rawVerify.length < 8 || rawVerify.length > 128) {
      throw new ForbiddenException("Verify token must be 8–128 characters (use a random string you also paste into Meta)");
    }
    verifyToken = rawVerify;
  }
  if (rawSecret !== undefined && rawSecret !== "") {
    if (rawSecret.length < 16) {
      throw new ForbiddenException("App secret looks too short (paste the full Meta app secret, or leave blank to keep)");
    }
    appSecret = rawSecret;
  }
  if (verifyToken === undefined && appSecret === undefined) {
    throw new ForbiddenException("Nothing to save — provide a verify token and/or app secret");
  }
  return { verifyToken, appSecret };
}

const NUMBER_SELECT = {
  id: true,
  orgId: true,
  label: true,
  provider: true,
  providerNumberId: true,
  businessAccountId: true,
  lastTestedAt: true,
  lastTestOk: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Delivery-status ordering: receipts only ever advance, never regress. */
const STATUS_RANK = { SENT: 0, DELIVERED: 1, READ: 2, FAILED: 3 } as const;

/** Actionable next step for known Meta send-error codes (safe to surface). */
export function failureHint(errorCode?: string): string | null {
  const code = String(errorCode ?? "").trim();
  if (code === "131047") return "outside the 24h window — resend with an approved template";
  if (code === "131026") return "message undeliverable — verify the recipient number is on WhatsApp";
  if (code === "132000" || code === "131000") return "Meta rejected the request — check the number status in Meta → WhatsApp → API Setup";
  return null;
}

@Injectable()
export class WhatsappService {
  private readonly log = new Logger(WhatsappService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MetaProvider) private readonly provider: WhatsappProvider,
    @Inject(NotificationsService) private readonly notify: NotificationsService,
  ) {}

  // -- numbers (owner-managed) -------------------------------------------

  async listNumbers(ctx: ActorCtx) {
    return this.prisma.whatsappNumber.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "asc" },
      select: { id: true, label: true, provider: true, providerNumberId: true, businessAccountId: true, lastTestedAt: true, lastTestOk: true, createdAt: true },
    });
  }

  // -- per-org webhook config (owner-managed, secrets never returned) --------

  /** Safe status view: flags only, never secret values. */
  async getConfig(ctx: ActorCtx) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can view integration settings");
    const cfg = await this.prisma.whatsappConfig.findUnique({ where: { orgId: ctx.orgId } });
    if (!cfg) return { configured: false as const, hasVerifyToken: false, hasAppSecret: false, updatedAt: null as Date | null };
    return {
      configured: true as const,
      hasVerifyToken: true,
      hasAppSecret: cfg.appSecret != null,
      updatedAt: cfg.updatedAt,
    };
  }

  async putConfig(ctx: ActorCtx, dto: any) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can edit integration settings");
    const parsed = validateWebhookConfigInput(dto);
    const existing = await this.prisma.whatsappConfig.findUnique({ where: { orgId: ctx.orgId } });
    if (!existing && parsed.verifyToken === undefined) {
      throw new ForbiddenException("Set a verify token first — it is required for Meta webhook verification");
    }
    const data: { verifyToken?: string; appSecret?: string } = {};
    // encryptToken fails closed (throws) without ENCRYPTION_KEY — never stored plaintext.
    if (parsed.verifyToken !== undefined) data.verifyToken = encryptToken(parsed.verifyToken);
    if (parsed.appSecret !== undefined) data.appSecret = encryptToken(parsed.appSecret);
    const cfg = existing
      ? await this.prisma.whatsappConfig.update({ where: { orgId: ctx.orgId }, data })
      : await this.prisma.whatsappConfig.create({ data: { orgId: ctx.orgId, verifyToken: data.verifyToken! } });
    return {
      configured: true as const,
      hasVerifyToken: true,
      hasAppSecret: cfg.appSecret != null,
      updatedAt: cfg.updatedAt,
    };
  }

  /** Tenant webhook verification: false when unconfigured, mismatched, or undecryptable. */
  async checkOrgVerifyToken(orgId: string, provided: unknown): Promise<boolean> {
    const cfg = await this.prisma.whatsappConfig.findUnique({ where: { orgId } });
    if (!cfg) return false;
    let expected: string;
    try {
      expected = decryptToken(cfg.verifyToken);
    } catch {
      return false;
    }
    return verifyTokenMatches(provided, expected);
  }

  /**
   * Tenant signing secret for inbound webhooks.
   * configured=false → caller falls back to the legacy global secret.
   * configured=true with secret=null → stored secret is undecryptable: fail closed.
   */
  async getOrgAppSecret(orgId: string): Promise<{ configured: boolean; secret: string | null }> {
    const cfg = await this.prisma.whatsappConfig.findUnique({ where: { orgId } });
    if (!cfg?.appSecret) return { configured: false, secret: null };
    try {
      return { configured: true, secret: decryptToken(cfg.appSecret) };
    } catch {
      return { configured: true, secret: null };
    }
  }

  async registerNumber(ctx: ActorCtx, dto: any) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can connect numbers");
    const parsed = validateNumberInput(dto);
    const stored = encryptToken(parsed.accessToken);
    const row = await this.prisma.whatsappNumber.upsert({
      where: { orgId_providerNumberId: { orgId: ctx.orgId, providerNumberId: parsed.providerNumberId } },
      update: { label: parsed.label, accessToken: stored, businessAccountId: parsed.businessAccountId },
      create: {
        orgId: ctx.orgId,
        label: parsed.label,
        providerNumberId: parsed.providerNumberId,
        accessToken: stored,
        businessAccountId: parsed.businessAccountId,
      },
      select: NUMBER_SELECT,
    });
    // Select above already excludes accessToken — never return credentials.
    return row;
  }

  async updateNumber(ctx: ActorCtx, id: string, dto: any) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can edit numbers");
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!n) throw new NotFoundException("Number not found");
    const merged = {
      label: dto?.label ?? n.label,
      providerNumberId: dto?.providerNumberId ?? n.providerNumberId,
      businessAccountId: dto?.businessAccountId ?? n.businessAccountId ?? undefined,
      // Empty string = keep existing token (allows label-only edits from settings forms).
      accessToken: String(dto?.accessToken ?? "").trim() ? String(dto.accessToken) : undefined,
    };
    const parsed = validateNumberInput(merged, { allowSameId: n.providerNumberId });
    if (merged.accessToken === undefined && parsed.providerNumberId !== n.providerNumberId) {
      throw new ForbiddenException("Changing the Phone Number ID requires re-entering the access token");
    }
    const data: { label: string; providerNumberId: string; businessAccountId: string | null; accessToken?: string } = {
      label: parsed.label,
      providerNumberId: parsed.providerNumberId,
      businessAccountId: parsed.businessAccountId,
    };
    if (merged.accessToken !== undefined) data.accessToken = encryptToken(parsed.accessToken);
    return this.prisma.whatsappNumber.update({
      where: { id },
      data,
      select: NUMBER_SELECT,
    });
  }

  /**
   * Manual-settings connection check: verifies the stored token against
   * Meta's Graph API without ever returning the token itself.
   * The outcome is persisted (lastTestedAt/lastTestOk) so the UI can
   * distinguish "saved" from "successfully tested".
   */
  async testNumber(ctx: ActorCtx, id: string) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can test numbers");
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!n) throw new NotFoundException("Number not found");
    const finish = async (result: { ok: boolean; reason?: string; displayPhone?: string | null; dryRun?: boolean }) => {
      // Proof-of-test must never break the check itself.
      try {
        await this.prisma.whatsappNumber.update({
          where: { id },
          data: { lastTestedAt: new Date(), lastTestOk: result.ok },
        });
      } catch (e) {
        this.log.warn(`test proof write failed (result kept): ${(e as Error).message}`);
      }
      return { ...result, providerNumberId: n.providerNumberId };
    };
    if (process.env.WHATSAPP_DRY_RUN === "1") {
      return finish({ ok: true as const, dryRun: true as const });
    }
    let token: string;
    try {
      token = decryptToken(n.accessToken);
    } catch {
      return finish({ ok: false as const, reason: "Stored token cannot be decrypted — reconnect the number with a fresh token from Meta" });
    }
    const version = metaApiVersion();
    try {
      const res = await fetch(
        `https://graph.facebook.com/${version}/${encodeURIComponent(n.providerNumberId)}?fields=id,display_phone_number`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const hint =
          res.status === 401 || res.status === 403
            ? "Check the access token in Meta → WhatsApp → API Setup and reconnect the number"
            : res.status === 404
              ? "Check the Phone Number ID in Meta → WhatsApp → API Setup and edit the number"
              : "Verify Meta API status, then retry the test";
        return finish({ ok: false as const, reason: `Meta rejected the credentials (${res.status}): ${text.slice(0, 160)}. ${hint}` });
      }
      const json = (await res.json()) as { id?: string; display_phone_number?: string };
      return finish({ ok: true as const, dryRun: false as const, displayPhone: json.display_phone_number ?? null });
    } catch (e) {
      return finish({ ok: false as const, reason: `Connection failed: ${(e as Error).message.slice(0, 160)}. Check network access to graph.facebook.com, then retry` });
    }
  }

  async removeNumber(ctx: ActorCtx, id: string) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can disconnect numbers");
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!n) throw new NotFoundException("Number not found");
    // Deleting a number cascades to its conversations and messages, so any
    // history at all blocks the disconnect — contacts and history are never
    // deleted by accident. Close-out is a deliberate data decision, not a settings click.
    const history = await this.prisma.conversation.count({ where: { whatsappNumberId: id } });
    if (history > 0) {
      const open = await this.prisma.conversation.count({ where: { whatsappNumberId: id, status: "OPEN" } });
      throw new ForbiddenException(
        open > 0
          ? `This number has ${history} conversation(s) (${open} open). Close or reassign the open conversations first — disconnected numbers keep their history and cannot be deleted while history exists`
          : `This number has ${history} closed conversation(s) in history. Disconnect is blocked to preserve contacts, messages and history`,
      );
    }
    await this.prisma.whatsappNumber.delete({ where: { id } });
    return { ok: true };
  }

  // -- ingest --------------------------------------------------------------

  async ingest(msg: InboundMessage, opts?: { expectedOrgId?: string }) {
    const number = await this.prisma.whatsappNumber.findFirst({
      where: { providerNumberId: msg.phoneNumberId },
    });
    if (!number) {
      this.log.warn(`Ignoring message for unknown number ${msg.phoneNumberId}`);
      return { ignored: true as const };
    }
    if (opts?.expectedOrgId && !checkTenantScope(number.orgId, opts.expectedOrgId)) {
      // Same Meta number registered in two orgs: a tenant webhook must never
      // write into the other tenant.
      this.log.warn(`Ignoring message: number ${msg.phoneNumberId} does not belong to this webhook tenant`);
      return { ignored: true as const };
    }
    const orgId = number.orgId;
    let phone: string;
    try {
      phone = waidToE164(msg.from);
    } catch {
      this.log.warn(`Ignoring message with bad sender ${msg.from}`);
      return { ignored: true as const };
    }
    const dupe = await this.prisma.message.findUnique({ where: { providerMessageId: msg.providerMessageId } });
    if (dupe) {
      // Meta redelivers on transport failures: a duplicate may carry a media
      // reference whose first backfill failed. Re-attempt without new writes
      // when the stored row still lacks its attachment.
      if (msg.mediaId && !dupe.mediaKey) {
        await this.attachMedia(orgId, dupe.id, {
          mediaId: msg.mediaId,
          mediaMime: msg.mediaMime,
          providerMessageId: msg.providerMessageId,
          providerNumberId: msg.phoneNumberId,
        });
      }
      return { duplicate: true as const };
    }

    return this.prisma.$transaction(async (tx) => {
      let contact = await tx.contact.findUnique({ where: { orgId_phoneE164: { orgId, phoneE164: phone } } });
      const adSource = msg.referral?.sourceUrl?.includes("instagram")
        ? "Instagram"
        : msg.referral?.sourceUrl?.includes("facebook")
          ? "Facebook"
          : undefined;
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            orgId,
            name: msg.profileName?.trim() || phone,
            phoneE164: phone,
            source: adSource ?? "WhatsApp",
            attribution: (msg.referral ? { ...msg.referral } : undefined) as Prisma.InputJsonValue | undefined,
            status: "ACTIVE",
          },
        });
        await logActivity(tx, { orgId, contactId: contact.id, type: "contact.created", payload: { via: "whatsapp" } });
      } else if (contact.status === "INACTIVE" || contact.status === "ARCHIVED") {
        contact = await tx.contact.update({ where: { id: contact.id }, data: { status: "ACTIVE" } });
        await logActivity(tx, { orgId, contactId: contact.id, type: "contact.reactivated", payload: { via: "whatsapp" } });
      }

      let conv = await tx.conversation.findFirst({
        where: { orgId, contactId: contact.id, whatsappNumberId: number.id, status: "OPEN" },
      });
      if (!conv) {
        conv = await tx.conversation.create({
          data: {
            orgId,
            contactId: contact.id,
            whatsappNumberId: number.id,
            assignedAgentId: contact.assignedAgentId,
            needsReply: true,
          },
        });
      }

      const mediaKey: string | null = null;
      // Media is non-essential: the core message is already durable below.
      // attachMedia() never throws — failures become timeline events, never rollbacks.
      const body = msg.text ?? (msg.type === "text" ? "" : `[${msg.type}${msg.mediaId ? " attachment" : ""}]`);
      const created = await tx.message.create({
        data: {
          orgId,
          conversationId: conv.id,
          providerMessageId: msg.providerMessageId,
          direction: "IN",
          type: msg.type,
          body,
          mediaKey,
          mediaMime: msg.mediaMime ?? null,
          sentAt: msg.timestamp,
        },
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: msg.timestamp, needsReply: true } });
      await tx.contact.update({ where: { id: contact.id }, data: { lastMessageAt: msg.timestamp } });
      // A human reply is on its way: pause automated sequences (human takes over).
      const active = await tx.enrollment.findMany({ where: { contactId: contact.id, status: "ACTIVE" }, select: { id: true } });
      for (const a of active) {
        await tx.enrollment.update({ where: { id: a.id }, data: { status: "PAUSED", nextRunAt: null } });
        await logActivity(tx, { orgId, contactId: contact.id, type: "sequence.paused", payload: { enrollmentId: a.id, reason: "contact replied" } });
      }
      await logActivity(tx, {
        orgId,
        contactId: contact.id,
        type: contact.status === "DNC" ? "contact.dnc.inbound" : "conversation.message",
        payload: { conversationId: conv.id, preview: body.slice(0, 120) } as Prisma.InputJsonValue,
      });
      const target = conv.assignedAgentId ?? contact.assignedAgentId;
      const notice = target
        ? { userId: target, owners: false as const }
        : { userId: "", owners: true as const };
      return { contactId: contact.id, conversationId: conv.id, messageId: created.id, notice, contactName: contact.name, preview: body.slice(0, 140) };
    }).then(async (result) => {
      // Webhook is acked only after the core message above is durable.
      // Media backfill is best-effort and can never fail the ingest.
      if (msg.mediaId) {
        await this.attachMedia(orgId, result.messageId, {
          mediaId: msg.mediaId,
          mediaMime: msg.mediaMime,
          providerMessageId: msg.providerMessageId,
          providerNumberId: msg.phoneNumberId,
        });
      }
      // Notifications are incidental: a failure here must never roll back
      // (or lose) the persisted message, so they run post-commit, guarded.
      try {
        if (result.notice.owners) {
          await this.notify.notifyOwners(orgId, "conversation.reply", `Unassigned reply from ${result.contactName}`, result.preview, `/inbox/${result.conversationId}`);
        } else {
          await this.notify.notify({
            orgId,
            userId: result.notice.userId,
            kind: "conversation.reply",
            title: `${result.contactName} replied`,
            body: result.preview,
            link: `/inbox/${result.conversationId}`,
          });
        }
      } catch (e) {
        this.log.warn(`reply notification failed (message kept): ${(e as Error).message}`);
      }
      return { contactId: result.contactId, conversationId: result.conversationId };
    });
  }

  /**
   * Best-effort media backfill for an already-persisted message. Never throws:
   * decrypt/download/store failures become a timeline event and the message
   * keeps its provider reference for a later retry via the same method.
   */
  async attachMedia(
    orgId: string,
    messageId: string,
    ref: { mediaId: string; mediaMime?: string; providerMessageId: string; providerNumberId: string },
  ): Promise<{ attached: boolean }> {
    try {
      const existing = await this.prisma.message.findFirst({ where: { id: messageId, orgId } });
      if (!existing) return { attached: false };
      if (existing.mediaKey) return { attached: true };
      const number = await this.prisma.whatsappNumber.findFirst({
        where: { orgId, providerNumberId: ref.providerNumberId },
      });
      if (!number) {
        this.log.warn(`media backfill skipped, number gone`);
        return { attached: false };
      }
      const media = await this.provider.fetchMedia({ mediaId: ref.mediaId, accessToken: decryptToken(number.accessToken) });
      if (!media) {
        await this.mediaFailed(orgId, existing, "download failed");
        return { attached: false };
      }
      if (media.bytes.length > MAX_MEDIA_BYTES) {
        await this.mediaFailed(orgId, existing, `attachment too large (${(media.bytes.length / 1048576).toFixed(1)} MB, limit 32 MB)`);
        return { attached: false };
      }
      const { putObject } = await import("@pgrow/storage");
      const mediaKey = `wa/${orgId}/${ref.providerMessageId}`;
      await putObject(mediaKey, media.bytes, media.mime);
      const contactId = await this.contactOf(existing.conversationId);
      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({ where: { id: existing.id }, data: { mediaKey, mediaMime: media.mime } });
        await logActivity(tx, {
          orgId,
          contactId,
          type: "conversation.media_attached",
          payload: { messageId: existing.id } as Prisma.InputJsonValue,
        });
      });
      return { attached: true };
    } catch (e) {
      this.log.warn(`media backfill failed: ${(e as Error).message}`);
      try {
        const existing = await this.prisma.message.findFirst({ where: { id: messageId, orgId } });
        if (existing) await this.mediaFailed(orgId, existing, (e as Error).message.slice(0, 120));
      } catch {
        // Audit write itself failed — message row is still durable; stop here.
      }
      return { attached: false };
    }
  }

  private async contactOf(conversationId: string): Promise<string> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true } });
    return conv?.contactId ?? "";
  }

  private async mediaFailed(
    orgId: string,
    existing: { id: string; conversationId: string },
    reason: string,
  ) {
    await logActivity(this.prisma, {
      orgId,
      contactId: await this.contactOf(existing.conversationId),
      type: "conversation.media_failed",
      payload: { messageId: existing.id, reason } as Prisma.InputJsonValue,
    });
  }

  /**
   * Delivery/read/failure receipts for our outbound messages. Unknown ids are
   * ignored (receipts for messages sent outside this system).
   *
   * Idempotent and order-safe: duplicate events are skipped without side
   * effects, and stale out-of-order events never regress a newer status
   * (e.g. a late `delivered` after `read`). Tenant-safe: when expectedOrgId
   * is set (per-org webhook path), receipts for another tenant are skipped.
   * Returns a summary for observability; never throws on unknown ids.
   */
  async applyStatuses(
    items: Array<{ providerMessageId: string; status: string; timestamp: Date; errorCode?: string; errorDetail?: string }>,
    opts?: { expectedOrgId?: string },
  ): Promise<{ updated: number; skipped: number; ignored: number }> {
    const summary = { updated: 0, skipped: 0, ignored: 0 };
    for (const s of items) {
      const msg = await this.prisma.message.findUnique({
        where: { providerMessageId: s.providerMessageId },
        include: { conversation: { select: { contactId: true, assignedAgentId: true } } },
      });
      if (!msg || msg.direction !== "OUT") {
        summary.ignored += 1;
        continue;
      }
      if (opts?.expectedOrgId && msg.orgId !== opts.expectedOrgId) {
        this.log.warn(`Ignoring status for another tenant's message ${s.providerMessageId}`);
        summary.skipped += 1;
        continue;
      }
      const mapped =
        s.status === "delivered" ? "DELIVERED" : s.status === "read" ? "READ" : s.status === "failed" || s.status === "deleted" ? "FAILED" : "SENT";
      if (STATUS_RANK[mapped] < STATUS_RANK[msg.status as keyof typeof STATUS_RANK] || mapped === msg.status) {
        // Stale out-of-order event, or an exact duplicate: no rewrite, and in
        // particular no second failure notification.
        summary.skipped += 1;
        continue;
      }
      const reason =
        mapped === "FAILED"
          ? [s.errorCode, s.errorDetail].filter(Boolean).join(" ").slice(0, 200) || "failed"
          : null;
      const hint = mapped === "FAILED" ? failureHint(s.errorCode) : null;
      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: { id: msg.id },
          data: { status: mapped as never, statusAt: s.timestamp, failureReason: [reason, hint].filter(Boolean).join(" — ").slice(0, 300) || null },
        });
        if (mapped === "FAILED") {
          const contact = await tx.contact.findUnique({ where: { id: msg.conversation.contactId } });
          await logActivity(tx, {
            orgId: msg.orgId,
            contactId: msg.conversation.contactId,
            type: "message.failed",
            payload: { messageId: msg.id, reason } as Prisma.InputJsonValue,
          });
          const target = msg.conversation.assignedAgentId ?? contact?.assignedAgentId;
          if (target) {
            await this.notify.notify({
              orgId: msg.orgId,
              userId: target,
              kind: "sequence.attention",
              title: `Message failed to deliver to ${contact?.name ?? "contact"}`,
              body: ([reason, hint].filter(Boolean).join(" — ") ?? "").slice(0, 140),
              link: `/inbox/${msg.conversationId}`,
            });
          }
        }
      });
      summary.updated += 1;
    }
    return summary;
  }

  // -- conversations ---------------------------------------------------------

  async listConversations(ctx: ActorCtx, view: string, take: number, skip: number) {
    const where: Prisma.ConversationWhereInput = { orgId: ctx.orgId };
    if (ctx.role === "AGENT") {
      where.assignedAgentId = ctx.userId;
    }
    switch (view) {
      case "needs-reply":
        where.status = "OPEN";
        where.needsReply = true;
        break;
      case "unassigned":
        where.status = "OPEN";
        where.assignedAgentId = null;
        break;
      case "mine":
        where.status = "OPEN";
        where.assignedAgentId = ctx.userId;
        break;
      case "closed":
        where.status = "CLOSED";
        break;
      case "recent":
      default:
        if (view && view !== "recent") throw new ForbiddenException("Unknown view");
        where.status = "OPEN";
        break;
    }
    const items = await this.prisma.conversation.findMany({
      where,
      include: {
        number: { select: { label: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(take || 50, 1), 200),
      skip: Math.max(skip || 0, 0),
    });
    const contactIds = [...new Set(items.map((c) => c.contactId))];
    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { id: true, name: true, phoneE164: true, status: true },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const total = await this.prisma.conversation.count({ where });
    return { items: items.map((c) => ({ ...c, contact: byId.get(c.contactId) ?? null })), total };
  }

  async getConversation(ctx: ActorCtx, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, orgId: ctx.orgId },
      include: {
        number: { select: { label: true } },
        messages: { orderBy: { sentAt: "asc" }, take: 500 },
      },
    });
    if (!conv) throw new NotFoundException("Conversation not found");
    if (ctx.role === "AGENT" && conv.assignedAgentId !== ctx.userId) {
      throw new ForbiddenException("Agents can only open their assigned conversations");
    }
    const contact = await this.prisma.contact.findUnique({
      where: { id: conv.contactId },
      include: { tags: { include: { tag: true } } },
    });
    return { ...conv, contact };
  }

  async updateConversation(ctx: ActorCtx, id: string, dto: any) {
    const conv = await this.prisma.conversation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!conv) throw new NotFoundException("Conversation not found");
    if (ctx.role === "AGENT" && conv.assignedAgentId !== ctx.userId) {
      throw new ForbiddenException("Agents can only manage their assigned conversations");
    }
    const data: Prisma.ConversationUpdateInput = {};
    if (dto.status !== undefined) {
      if (dto.status !== "OPEN" && dto.status !== "CLOSED") throw new ForbiddenException("Invalid status");
      data.status = dto.status;
      if (dto.status === "CLOSED") {
        data.needsReply = false;
      } else {
        const needs = !conv.lastInboundAt ? false : !conv.lastOutboundAt || conv.lastInboundAt > conv.lastOutboundAt;
        data.needsReply = needs;
      }
    }
    if (dto.assignedAgentId !== undefined) {
      if (dto.assignedAgentId) {
        const m = await this.prisma.membership.findUnique({
          where: { orgId_userId: { orgId: ctx.orgId, userId: dto.assignedAgentId } },
        });
        if (!m || !m.active) throw new ForbiddenException("Assignee must be an active team member");
        data.assignedAgentId = dto.assignedAgentId;
      } else {
        data.assignedAgentId = null;
      }
    }
    const updated = await this.prisma.conversation.update({ where: { id }, data });
    if (dto.assignedAgentId && dto.assignedAgentId !== conv.assignedAgentId) {
      await this.notify.notify({
        orgId: ctx.orgId,
        userId: dto.assignedAgentId,
        kind: "conversation.assigned",
        title: `Conversation assigned to you`,
        body: `Assigned by ${ctx.userId}`,
        link: `/inbox/${id}`,
      });
    }
    await logActivity(this.prisma, {
      orgId: ctx.orgId,
      contactId: conv.contactId,
      type: "conversation.updated",
      actorId: ctx.userId,
      payload: { conversationId: id, status: updated.status, assignedAgentId: updated.assignedAgentId } as Prisma.InputJsonValue,
    });
    if (dto.assignedAgentId !== undefined) {
      await this.prisma.contact.update({ where: { id: conv.contactId }, data: { assignedAgentId: updated.assignedAgentId } });
    }
    return updated;
  }

  async reply(ctx: ActorCtx, id: string, text: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { number: true },
    });
    if (!conv) throw new NotFoundException("Conversation not found");
    if (ctx.role === "AGENT" && conv.assignedAgentId !== ctx.userId) {
      throw new ForbiddenException("Agents can only reply in their assigned conversations");
    }
    const contact = await this.prisma.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
    assertVisible(contact, ctx);
    if (contact.status === "DNC") throw new ForbiddenException("Contact is Do Not Contact");
    if (!text?.trim()) throw new ForbiddenException("Message text required");
    if (conv.status === "CLOSED") {
      await this.prisma.conversation.update({ where: { id }, data: { status: "OPEN" } });
    }
    let sent: { providerMessageId: string; via: "text" | "template" };
    try {
      sent = await this.provider.sendOutbound({
        phoneNumberId: conv.number.providerNumberId,
        accessToken: decryptToken(conv.number.accessToken),
        to: contact.phoneE164,
        body: text.trim(),
        contactName: contact.name,
        lastInboundAt: conv.lastInboundAt,
      });
    } catch (e) {
      // Provider rejection is persisted as actionable history (FAILED row +
      // timeline event) instead of vanishing — then rethrown so the caller
      // still sees the error.
      const reason = (e as Error).message.slice(0, 300);
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        const failed = await tx.message.create({
          data: {
            orgId: ctx.orgId,
            conversationId: id,
            providerMessageId: `sendfail-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            direction: "OUT",
            type: "text",
            body: text.trim(),
            status: "FAILED" as never,
            statusAt: now,
            failureReason: reason,
            sentAt: now,
          },
        });
        await logActivity(tx, {
          orgId: ctx.orgId,
          contactId: contact.id,
          type: "message.failed",
          actorId: ctx.userId,
          payload: { conversationId: id, messageId: failed.id, reason } as Prisma.InputJsonValue,
        });
      });
      throw e;
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          orgId: ctx.orgId,
          conversationId: id,
          providerMessageId: sent.providerMessageId,
          direction: "OUT",
          type: "text",
          body: text.trim(),
          templateName: sent.via === "template" ? (process.env.WHATSAPP_FALLBACK_TEMPLATE?.trim() || null) : null,
          sentAt: now,
        },
      });
      await tx.conversation.update({ where: { id }, data: { lastOutboundAt: now, needsReply: false } });
      await tx.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId: contact.id,
        type: "conversation.reply",
        actorId: ctx.userId,
        payload: { conversationId: id, preview: text.trim().slice(0, 120) },
      });
    });
    return { ok: true, providerMessageId: sent.providerMessageId };
  }
}

