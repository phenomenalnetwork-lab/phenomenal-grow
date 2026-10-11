import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import type { ActorCtx } from "../contacts/contacts.service";

function range(from?: string, to?: string) {
  const gte = from ? new Date(from) : new Date(0);
  const lte = to ? new Date(to) : new Date();
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) {
    throw new ForbiddenException("Invalid date range");
  }
  return { gte, lte };
}

/** Owner-only org reporting: what happened, what works, what needs attention. */
@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private requireOwner(ctx: ActorCtx) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners view reports");
  }

  async overview(ctx: ActorCtx, from?: string, to?: string) {
    this.requireOwner(ctx);
    const { orgId } = ctx;
    const created = range(from, to);

    const [contactsNew, contactsByStatus, contactsBySource] = await Promise.all([
      this.prisma.contact.count({ where: { orgId, createdAt: created } }),
      this.prisma.contact.groupBy({ by: ["status"], where: { orgId }, _count: true }),
      this.prisma.contact.groupBy({ by: ["source"], where: { orgId, createdAt: created }, _count: true, orderBy: { _count: { source: "desc" } }, take: 10 }),
    ]);

    const pipelines = await this.prisma.pipeline.findMany({
      where: { orgId },
      include: { stages: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const pipelineStats = await Promise.all(
      pipelines.map(async (p) => {
        const [entered, converted, notConverted, ongoing, byStage] = await Promise.all([
          this.prisma.contactPipeline.count({ where: { pipelineId: p.id, enteredAt: created } }),
          this.prisma.contactPipeline.count({ where: { pipelineId: p.id, outcome: "CONVERTED", convertedAt: created } }),
          this.prisma.contactPipeline.count({ where: { pipelineId: p.id, outcome: "NOT_CONVERTED" } }),
          this.prisma.contactPipeline.count({ where: { pipelineId: p.id, outcome: "ONGOING" } }),
          this.prisma.contactPipeline.groupBy({ by: ["stageId"], where: { pipelineId: p.id, outcome: "ONGOING" }, _count: true }),
        ]);
        const stageName = new Map(p.stages.map((s) => [s.id, s.name]));
        return {
          pipeline: p.name,
          entered,
          converted,
          notConverted,
          ongoing,
          byStage: byStage.map((g) => ({ stage: stageName.get(g.stageId) ?? "?", count: g._count })),
        };
      }),
    );

    const now = new Date();
    const sod = new Date(now);
    sod.setHours(0, 0, 0, 0);
    const [fuCompleted, fuOverdue, fuDueToday, fuOutstanding] = await Promise.all([
      this.prisma.followup.count({ where: { orgId, doneAt: created } }),
      this.prisma.followup.count({ where: { orgId, doneAt: null, dueAt: { lt: sod } } }),
      this.prisma.followup.count({ where: { orgId, doneAt: null, dueAt: { gte: sod } } }),
      this.prisma.followup.count({ where: { orgId, doneAt: null } }),
    ]);

    const [convCounts, reasons] = await Promise.all([
      this.prisma.contactPipeline.groupBy({ by: ["outcome"], where: { orgId }, _count: true }),
      this.prisma.contactPipeline.groupBy({ by: ["outcomeReason"], where: { orgId, outcome: "NOT_CONVERTED" }, _count: true }),
    ]);
    const conv = convCounts.find((c) => c.outcome === "CONVERTED")?._count ?? 0;
    const notConv = convCounts.find((c) => c.outcome === "NOT_CONVERTED")?._count ?? 0;
    const conversionRate = conv + notConv > 0 ? Math.round((conv / (conv + notConv)) * 100) : 0;

    const sources = contactsBySource.map((s) => s.source ?? "—");
    const funnel = await Promise.all(
      sources.map(async (source) => {
        const contacts = await this.prisma.contact.findMany({
          where: { orgId, ...(source === "—" ? { source: null } : { source }), createdAt: created },
          select: { id: true },
        });
        const ids = contacts.map((c) => c.id);
        const [conversations, converted] = ids.length
          ? await Promise.all([
              this.prisma.conversation.count({ where: { orgId, contactId: { in: ids } } }),
              this.prisma.contactPipeline.count({ where: { orgId, contactId: { in: ids }, outcome: "CONVERTED" } }),
            ])
          : [0, 0];
        return { source, contacts: ids.length, conversations, converted };
      }),
    );

    const members = await this.prisma.membership.findMany({
      where: { orgId, active: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const agents = await Promise.all(
      members.map(async (m) => {
        const [handled, fuDone, outstanding, conversions, replies] = await Promise.all([
          this.prisma.contact.count({ where: { orgId, assignedAgentId: m.userId } }),
          this.prisma.followup.count({ where: { orgId, assignedAgentId: m.userId, doneAt: created } }),
          this.prisma.followup.count({ where: { orgId, assignedAgentId: m.userId, doneAt: null } }),
          this.prisma.activity.count({ where: { orgId, type: "contact.converted", actorId: m.userId, at: created } }),
          this.prisma.activity.count({ where: { orgId, type: "conversation.reply", actorId: m.userId, at: created } }),
        ]);
        return { user: m.user, handled, followupsCompleted: fuDone, outstanding, conversions, replies };
      }),
    );

    return {
      range: { from: created.gte, to: created.lte },
      contacts: { new: contactsNew, byStatus: contactsByStatus },
      pipelines: pipelineStats,
      followups: { completed: fuCompleted, overdue: fuOverdue, dueToday: fuDueToday, outstanding: fuOutstanding },
      conversions: { byOutcome: convCounts, reasons, rate: conversionRate },
      funnel,
      agents,
    };
  }

  async overviewCsv(ctx: ActorCtx, from?: string, to?: string): Promise<string> {
    const o = await this.overview(ctx, from, to);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["section,metric,value"];
    lines.push(["contacts", "new", o.contacts.new].map(esc).join(","));
    for (const g of o.contacts.byStatus) lines.push(["contacts", `status:${g.status}`, g._count].map(esc).join(","));
    for (const p of o.pipelines) {
      lines.push(["pipeline", `${p.pipeline}:entered`, p.entered].map(esc).join(","));
      lines.push(["pipeline", `${p.pipeline}:converted`, p.converted].map(esc).join(","));
      lines.push(["pipeline", `${p.pipeline}:not_converted`, p.notConverted].map(esc).join(","));
      lines.push(["pipeline", `${p.pipeline}:ongoing`, p.ongoing].map(esc).join(","));
    }
    lines.push(["followups", "completed", o.followups.completed].map(esc).join(","));
    lines.push(["followups", "overdue", o.followups.overdue].map(esc).join(","));
    lines.push(["followups", "outstanding", o.followups.outstanding].map(esc).join(","));
    lines.push(["conversions", "rate_pct", o.conversions.rate].map(esc).join(","));
    for (const f of o.funnel) {
      lines.push(["source", `${f.source}:contacts`, f.contacts].map(esc).join(","));
      lines.push(["source", `${f.source}:conversations`, f.conversations].map(esc).join(","));
      lines.push(["source", `${f.source}:converted`, f.converted].map(esc).join(","));
    }
    for (const a of o.agents) {
      lines.push(["agent", `${a.user.email}:handled`, a.handled].map(esc).join(","));
      lines.push(["agent", `${a.user.email}:conversions`, a.conversions].map(esc).join(","));
    }
    return lines.join("\n");
  }
}
