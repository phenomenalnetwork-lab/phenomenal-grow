import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { logActivity } from "../contacts/activity";
import { assertVisible, type ActorCtx } from "../contacts/contacts.service";

@Injectable()
export class FollowupsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(NotificationsService) private readonly notify: NotificationsService) {}

  async list(ctx: ActorCtx, view: string) {
    const where: Record<string, unknown> = { orgId: ctx.orgId, doneAt: null };
    if (ctx.role === "AGENT") {
      where.assignedAgentId = ctx.userId;
    } else if (view === "mine") {
      where.assignedAgentId = ctx.userId;
    }
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (view === "overdue") {
      (where as Record<string, unknown>).dueAt = { lt: startOfToday };
    } else if (view === "today") {
      (where as Record<string, unknown>).dueAt = { gte: startOfToday, lte: endOfToday };
    } else if (view && view !== "mine" && view !== "all") {
      throw new ForbiddenException("Unknown view (overdue|today|mine|all)");
    }
    const items = await this.prisma.followup.findMany({
      where: where as never,
      include: { contact: { select: { id: true, name: true, phoneE164: true } } },
      orderBy: { dueAt: "asc" },
      take: 200,
    });
    return { items, total: items.length };
  }

  async create(ctx: ActorCtx, contactId: string, dto: any) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    const title = String(dto?.title ?? "").trim();
    if (!title) throw new BadRequestException("Title is required");
    const dueAt = dto?.dueAt ? new Date(dto.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) throw new BadRequestException("Valid dueAt is required");
    let assignee: string | null = dto?.assignedAgentId ?? (ctx.role === "AGENT" ? ctx.userId : contact!.assignedAgentId);
    if (assignee) {
      const m = await this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: ctx.orgId, userId: assignee } },
      });
      if (!m || !m.active) throw new BadRequestException("Assignee must be an active team member");
    }
    const f = await this.prisma.$transaction(async (tx) => {
      const created = await tx.followup.create({
        data: { orgId: ctx.orgId, contactId, title, dueAt, assignedAgentId: assignee },
      });
      await logActivity(tx, { orgId: ctx.orgId, contactId, type: "followup.created", actorId: ctx.userId, payload: { followupId: created.id, title } });
      return created;
    });
    if (assignee && assignee !== ctx.userId) {
      await this.notify.notify({
        orgId: ctx.orgId,
        userId: assignee,
        kind: "followup.created",
        title: `Follow-up assigned: ${title}`,
        body: `Due ${dueAt.toISOString().slice(0, 16)}`,
        link: `/followups?view=mine`,
      });
    }
    return f;
  }

  async update(ctx: ActorCtx, id: string, dto: any) {
    const f = await this.prisma.followup.findFirst({ where: { id, orgId: ctx.orgId }, include: { contact: true } });
    if (!f) throw new NotFoundException("Follow-up not found");
    assertVisible(f.contact, ctx);
    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) {
      if (!String(dto.title).trim()) throw new BadRequestException("Title cannot be empty");
      data.title = String(dto.title).trim();
    }
    if (dto.dueAt !== undefined) {
      const d = new Date(dto.dueAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid dueAt");
      data.dueAt = d;
    }
    if (dto.done !== undefined) data.doneAt = dto.done === true ? new Date() : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.followup.update({ where: { id }, data: data as never });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId: f.contactId,
        type: dto.done === true ? "followup.completed" : "followup.updated",
        actorId: ctx.userId,
        payload: { followupId: id },
      });
      return u;
    });
    return updated;
  }
}
