import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
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
    return this.prisma.whatsappNumber.upsert({
      where: { orgId_providerNumberId: { orgId: ctx.orgId, providerNumberId } },
      update: { label, accessToken, businessAccountId: dto?.businessAccountId?.trim() || null },
      create: { orgId: ctx.orgId, label, providerNumberId, accessToken, businessAccountId: dto?.businessAccountId?.trim() || null },
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
    if (dupe) return { duplicate: true as const };

    return this.prisma.$transaction(async (tx) => {
      let contact = await tx.contact.findUnique({ where: { orgId_phoneE164: { orgId, phoneE164: phone } } });
      if (!contact) {
        contact = await tx.contact.create({
          data: {
            orgId,
            name: msg.profileName?.trim() || phone,
            phoneE164: phone,
            source: "WhatsApp",
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
      if (msg.mediaId) {
        const media = await this.provider.fetchMedia({ mediaId: msg.mediaId, accessToken: number.accessToken });
        if (media) {
          try {
            const { putObject } = await import("@pgrow/storage");
            mediaKey = `wa/${orgId}/${msg.providerMessageId}`;
            await putObject(mediaKey, media.bytes, media.mime);
          } catch (e) {
            this.log.warn(`R2 store failed, keeping reference only: ${(e as Error).message}`);
            mediaKey = null;
          }
        }
      }

      const body = msg.text ?? (msg.type === "text" ? "" : `[${msg.type}${msg.mediaId ? " attachment" : ""}]`);
      await tx.message.create({
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
      await logActivity(tx, {
        orgId,
        contactId: contact.id,
        type: contact.status === "DNC" ? "contact.dnc.inbound" : "conversation.message",
        payload: { conversationId: conv.id, preview: body.slice(0, 120) } as Prisma.InputJsonValue,
      });
      return { contactId: contact.id, conversationId: conv.id };
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
      accessToken: conv.number.accessToken,
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
