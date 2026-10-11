import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import type { ActorCtx } from "../contacts/contacts.service";

/**
 * Action dashboard: "who needs me right now?" Priority stack —
 * needs-reply → overdue → due-today → new contacts → opportunities → snapshot.
 * Agents see only their slice; owners see everything plus a team rollup.
 */
@Injectable()
export class HomeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private contactScope(ctx: ActorCtx): Prisma.ContactWhereInput {
    return ctx.role === "AGENT" ? { assignedAgentId: ctx.userId } : {};
  }

  async dashboard(ctx: ActorCtx) {
    const { orgId, userId, role } = ctx;
    const agent = role === "AGENT";
    const scope = this.contactScope(ctx);
    const now = new Date();
    const sod = new Date(now);
    sod.setHours(0, 0, 0, 0);
    const eod = new Date(now);
    eod.setHours(23, 59, 59, 999);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const needsReply = await this.prisma.conversation.findMany({
      where: { orgId, status: "OPEN", needsReply: true, ...(agent ? { assignedAgentId: userId } : {}) },
      include: { number: { select: { label: true } } },
      orderBy: { lastInboundAt: "asc" },
      take: 10,
    });
    const needsReplyContacts = await this.prisma.contact.findMany({
      where: { id: { in: [...new Set(needsReply.map((c) => c.contactId))] } },
      select: { id: true, name: true, phoneE164: true, status: true },
    });
    const contactById = new Map(needsReplyContacts.map((c) => [c.id, c]));
    const needsReplyWithContact = needsReply.map((c) => ({ ...c, contact: contactById.get(c.contactId) ?? null }));
    const needsReplyIds = new Set(needsReply.map((c) => c.contactId));

    const fuBase: Prisma.FollowupWhereInput = agent
      ? { orgId, doneAt: null, OR: [{ assignedAgentId: userId }, { contact: { assignedAgentId: userId } }] }
      : { orgId, doneAt: null };
    const [overdue, dueToday] = await Promise.all([
      this.prisma.followup.findMany({
        where: { ...fuBase, dueAt: { lt: sod } },
        include: { contact: { select: { id: true, name: true, phoneE164: true } } },
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
      this.prisma.followup.findMany({
        where: { ...fuBase, dueAt: { gte: sod, lte: eod } },
        include: { contact: { select: { id: true, name: true, phoneE164: true } } },
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
    ]);
    const overdueByContact = new Map<string, string>();
    for (const f of overdue) if (!overdueByContact.has(f.contactId)) overdueByContact.set(f.contactId, f.title);
    const todayByContact = new Map<string, string>();
    for (const f of dueToday) if (!todayByContact.has(f.contactId)) todayByContact.set(f.contactId, f.title);

    const newContactsRaw = await this.prisma.contact.findMany({
      where: { orgId, status: "ACTIVE", createdAt: { gte: weekAgo }, pipelines: { none: {} }, ...scope },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const opportunities = await this.prisma.contactPipeline.findMany({
      where: { orgId, outcome: "ONGOING", contact: scope },
      include: {
        contact: { select: { id: true, name: true, phoneE164: true, nextActionAt: true } },
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, expectedAction: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    const suggest = (contactId: string, fallback: string, nextActionAt?: Date | null): string => {
      if (needsReplyIds.has(contactId)) return "Reply";
      const od = overdueByContact.get(contactId);
      if (od) return `Complete: ${od}`;
      const td = todayByContact.get(contactId);
      if (td) return `Due today: ${td}`;
      if (nextActionAt) return "Next action due";
      return fallback;
    };

    const newContacts = newContactsRaw.map((c) => ({ ...c, suggested: suggest(c.id, "Qualify & place in a pipeline", c.nextActionAt) }));
    const opps = opportunities.map((o) => ({
      ...o,
      suggested: suggest(o.contactId, o.stage.expectedAction ?? "Move stage", o.contact.nextActionAt),
    }));

    const [contactsByStatus, openConvs, needsReplyCount, openFollowups, overdueCount, dueTodayCount, activeEnrollments, outcomes, sources, convertedCount] =
      await Promise.all([
        this.prisma.contact.groupBy({ by: ["status"], where: { orgId, ...scope }, _count: true }),
        this.prisma.conversation.count({ where: { orgId, status: "OPEN", ...(agent ? { assignedAgentId: userId } : {}) } }),
        this.prisma.conversation.count({ where: { orgId, status: "OPEN", needsReply: true, ...(agent ? { assignedAgentId: userId } : {}) } }),
        this.prisma.followup.count({ where: fuBase }),
        this.prisma.followup.count({ where: { ...fuBase, dueAt: { lt: sod } } }),
        this.prisma.followup.count({ where: { ...fuBase, dueAt: { gte: sod, lte: eod } } }),
        this.prisma.enrollment.count({ where: { orgId, status: "ACTIVE" } }),
        this.prisma.contactPipeline.groupBy({ by: ["outcome"], where: { orgId }, _count: true }),
        this.prisma.contact.groupBy({ by: ["source"], where: { orgId }, _count: true, orderBy: { _count: { source: "desc" } }, take: 5 }),
        this.prisma.contactPipeline.count({ where: { orgId, outcome: "CONVERTED" } }),
      ]);

    const completedFollowups = await this.prisma.followup.findMany({
      where: { ...fuBase, doneAt: { gte: sod } },
      include: { contact: { select: { id: true, name: true } } },
      orderBy: { doneAt: "desc" },
      take: 10,
    });
    const repliesToday = await this.prisma.activity.count({
      where: { orgId, type: "conversation.reply", at: { gte: sod }, ...(agent ? { actorId: userId } : {}) },
    });

    let team: unknown = null;
    if (!agent) {
      const members = await this.prisma.membership.findMany({
        where: { orgId, active: true },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      });
      team = await Promise.all(
        members.map(async (m) => {
          const [assigned, open, overdueN, conversions, replies] = await Promise.all([
            this.prisma.contact.count({ where: { orgId, assignedAgentId: m.userId, status: "ACTIVE" } }),
            this.prisma.followup.count({ where: { orgId, assignedAgentId: m.userId, doneAt: null } }),
            this.prisma.followup.count({ where: { orgId, assignedAgentId: m.userId, doneAt: null, dueAt: { lt: sod } } }),
            this.prisma.activity.count({ where: { orgId, type: "contact.converted", actorId: m.userId } }),
            this.prisma.activity.count({ where: { orgId, type: "conversation.reply", actorId: m.userId, at: { gte: weekAgo } } }),
          ]);
          return { user: m.user, role: m.role, assigned, openFollowups: open, overdue: overdueN, conversions, replies7d: replies };
        }),
      );
    }

    return {
      needsReply: needsReplyWithContact,
      overdue,
      dueToday,
      newContacts,
      opportunities: opps,
      snapshot: {
        contactsByStatus,
        conversationsOpen: openConvs,
        needsReplyCount,
        followupsOpen: openFollowups,
        followupsOverdue: overdueCount,
        followupsDueToday: dueTodayCount,
        enrollmentsActive: activeEnrollments,
        outcomes,
        topSources: sources,
        convertedTotal: convertedCount,
      },
      completedToday: { followups: completedFollowups, replies: repliesToday },
      appointmentsToday: [],
      team,
    };
  }
}
