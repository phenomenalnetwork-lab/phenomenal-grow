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
import { MetaProvider } from "./meta.provider";

function waidToE164(waId: string): string {
  return normalizePhone(`+${waId.replace(/\D/g, "")}`);
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
      select: { id: true, label: true, provider: true, providerNumberId: true, businessAccountId: true, createdAt: true },
    });
  }

  async registerNumber(ctx: ActorCtx, dto: any) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can connect numbers");
    const label = String(dto?.label ?? "").trim();
    const providerNumberId = String(dto?.providerNumberId ?? "").trim();
    const accessToken = String(dto?.accessToken ?? "").trim();
    if (!label || !providerNumberId || !accessToken) {
      throw new ForbiddenException("label, providerNumberId and accessToken are required");
    }
    const stored = encryptToken(accessToken);
    return this.prisma.whatsappNumber.upsert({
      where: { orgId_providerNumberId: { orgId: ctx.orgId, providerNumberId } },
      update: { label, accessToken: stored, businessAccountId: dto?.businessAccountId?.trim() || null },
      create: { orgId: ctx.orgId, label, providerNumberId, accessToken: stored, businessAccountId: dto?.businessAccountId?.trim() || null },
    });
  }

  async removeNumber(ctx: ActorCtx, id: string) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can disconnect numbers");
    const n = await this.prisma.whatsappNumber.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!n) throw new NotFoundException("Number not found");
    const open = await this.prisma.conversation.count({ where: { whatsappNumberId: id, status: "OPEN" } });
    if (open > 0) throw new ForbiddenException("Close or reassign open conversations first");
    await this.prisma.whatsappNumber.delete({ where: { id } });
    return { ok: true };
  }

  // -- ingest --------------------------------------------------------------

  async ingest(msg: InboundMessage) {
    const number = await this.prisma.whatsappNumber.findFirst({
      where: { providerNumberId: msg.phoneNumberId },
    });
    if (!number) {
      this.log.warn(`Ignoring message for unknown number ${msg.phoneNumberId}`);
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

      let mediaKey: string | null = null;
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
    const sent = await this.provider.sendText({
      phoneNumberId: conv.number.providerNumberId,
      accessToken: decryptToken(conv.number.accessToken),
      to: contact.phoneE164,
      body: text.trim(),
    });
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

