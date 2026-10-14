import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import PgBoss from "pg-boss";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { decryptToken } from "../common/crypto";
import { logActivity } from "../contacts/activity";
import { MetaProvider } from "../whatsapp/meta.provider";

export const SEND_QUEUE = "sequence.send";
export const SWEEP_QUEUE = "sequence.sweep";
export const REENGAGE_QUEUE = "reengage.sweep";
export const APPT_SEND_QUEUE = "appt.send";
export const APPT_FOLLOWUP_QUEUE = "appt.followup";

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function renderBody(template: string, contactName: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/gi, firstName(contactName));
}

/** Durable follow-up engine: pg-boss queues + schedules, Postgres-backed. */
@Injectable()
export class SequencesEngine implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SequencesEngine.name);
  private boss: PgBoss | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MetaProvider) private readonly sender: MetaProvider,
    @Inject(NotificationsService) private readonly notify: NotificationsService,
  ) {}

  async onModuleInit() {
    if (process.env.SKIP_ENGINE === "1") {
      this.log.warn("Engine disabled (SKIP_ENGINE=1)");
      return;
    }
    try {
      this.boss = new PgBoss(process.env.DATABASE_URL!);
      this.boss.on("error", (e) => this.log.error(`boss: ${e.message}`));
      await this.boss.start();
      await this.boss.createQueue(SEND_QUEUE);
      await this.boss.createQueue(SWEEP_QUEUE);
      await this.boss.createQueue(REENGAGE_QUEUE);
      await this.boss.createQueue(APPT_SEND_QUEUE);
      await this.boss.createQueue(APPT_FOLLOWUP_QUEUE);
      await this.boss.schedule(SWEEP_QUEUE, "* * * * *");
      await this.boss.schedule(REENGAGE_QUEUE, "*/15 * * * *");
      await this.boss.work(SEND_QUEUE, async (jobs) => {
        for (const job of jobs) await this.sendStep(String((job.data as any)?.enrollmentId ?? ""));
      });
      await this.boss.work(APPT_SEND_QUEUE, async (jobs) => {
        for (const job of jobs) {
          const d = (job.data as any) ?? {};
          await this.sendAppointmentNudge(String(d.appointmentId ?? ""), d.kind === "reminder" ? "reminder" : "confirm");
        }
      });
      await this.boss.work(APPT_FOLLOWUP_QUEUE, async (jobs) => {
        for (const job of jobs) await this.postAppointmentFollowup(String((job.data as any)?.appointmentId ?? ""));
      });
      await this.boss.work(SWEEP_QUEUE, async () => {
        await this.sweepDue();
        await this.sweepFollowupNotices();
      });
      await this.boss.work(REENGAGE_QUEUE, async () => this.sweepReengage(30));
      this.log.log("Sequences engine started (pg-boss)");
    } catch (e) {
      this.log.error(`Engine failed to start, sequences will not auto-send: ${(e as Error).message}`);
      this.boss = null;
    }
  }

  async onModuleDestroy() {
    await this.boss?.stop();
  }

  /** Enqueue due steps. Called by schedule and directly after enroll. */
  async sweepDue() {
    if (!this.boss) return 0;
    const due = await this.prisma.enrollment.findMany({
      where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
      select: { id: true },
      take: 200,
    });
    for (const e of due) {
      await this.boss.send(SEND_QUEUE, { enrollmentId: e.id }, { singletonKey: e.id });
    }
    return due.length;
  }

  private async stopEnrollment(
    tx: Prisma.TransactionClient,
    e: { id: string; orgId: string; contactId: string },
    reason: string,
    type: string,
  ) {
    await tx.enrollment.update({ where: { id: e.id }, data: { status: "STOPPED", stopReason: reason, nextRunAt: null } });
    await logActivity(tx, { orgId: e.orgId, contactId: e.contactId, type, payload: { enrollmentId: e.id, reason } });
  }

  async sendStep(enrollmentId: string) {
    if (!enrollmentId) return;
    const e = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { sequence: { include: { steps: { orderBy: { order: "asc" } } } }, contact: true },
    });
    if (!e || e.status !== "ACTIVE" || !e.sequence.active) return;
    const step = e.sequence.steps[e.currentStep];
    if (!step) {
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextRunAt: null } });
        await logActivity(tx, { orgId: e.orgId, contactId: e.contactId, type: "sequence.completed", payload: { enrollmentId: e.id } });
      });
      return;
    }
    // Guards: DNC always wins; conversion stops non-post-conversion flows.
    if (e.contact.status === "DNC") {
      await this.prisma.$transaction((tx) => this.stopEnrollment(tx, e, "dnc", "sequence.stopped"));
      return;
    }
    if (!e.sequence.postConversion) {
      const converted = await this.prisma.contactPipeline.findFirst({
        where: { contactId: e.contactId, outcome: "CONVERTED" },
      });
      if (converted) {
        await this.prisma.$transaction((tx) => this.stopEnrollment(tx, e, "converted", "sequence.stopped"));
        return;
      }
    }
    // Resolve sending number: open conversation's number, else org's first.
    const conv = await this.prisma.conversation.findFirst({
      where: { orgId: e.orgId, contactId: e.contactId, status: "OPEN" },
      include: { number: true },
      orderBy: { updatedAt: "desc" },
    });
    const number =
      conv?.number ??
      (await this.prisma.whatsappNumber.findFirst({ where: { orgId: e.orgId }, orderBy: { createdAt: "asc" } }));
    if (!number) {
      await this.prisma.enrollment.update({
        where: { id: e.id },
        data: { nextRunAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await logActivity(this.prisma, {
        orgId: e.orgId,
        contactId: e.contactId,
        type: "sequence.waiting",
        payload: { enrollmentId: e.id, reason: "no whatsapp number connected" },
      });
      return;
    }
    const body = renderBody(step.body, e.contact.name);
    try {
      const sent = await this.sender.sendOutbound({
        phoneNumberId: number.providerNumberId,
        accessToken: decryptToken(number.accessToken),
        to: e.contact.phoneE164,
        body,
        contactName: e.contact.name,
        lastInboundAt: e.contact.lastMessageAt,
      });
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        let conversationId = conv?.id;
        if (!conversationId) {
          const created = await tx.conversation.create({
            data: { orgId: e.orgId, contactId: e.contactId, whatsappNumberId: number.id, assignedAgentId: e.contact.assignedAgentId },
          });
          conversationId = created.id;
        }
        await tx.message.create({
          data: {
            orgId: e.orgId,
            conversationId,
            providerMessageId: sent.providerMessageId,
            direction: "OUT",
            type: "text",
            body,
            templateName: sent.via === "template" ? (process.env.WHATSAPP_FALLBACK_TEMPLATE?.trim() || null) : null,
            sentAt: now,
          },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: now, needsReply: false } });
        const next = e.sequence.steps[e.currentStep + 1];
        if (next) {
          await tx.enrollment.update({
            where: { id: e.id },
            data: {
              currentStep: e.currentStep + 1,
              nextRunAt: new Date(e.enrolledAt.getTime() + next.dayOffset * 86400000),
              attempts: 0,
            },
          });
        } else {
          await tx.enrollment.update({ where: { id: e.id }, data: { status: "COMPLETED", nextRunAt: null } });
        }
        await logActivity(tx, {
          orgId: e.orgId,
          contactId: e.contactId,
          type: "sequence.sent",
          payload: { enrollmentId: e.id, step: e.currentStep, preview: body.slice(0, 120) },
        });
      });
    } catch (err) {
      const attempts = e.attempts + 1;
      await this.prisma.$transaction(async (tx) => {
        if (attempts >= 5) {
          await this.stopEnrollment(tx, e, "send-failed", "sequence.stopped");
        } else {
          await tx.enrollment.update({
            where: { id: e.id },
            data: { attempts, nextRunAt: new Date(Date.now() + 30 * 60 * 1000) },
          });
        }
        await logActivity(tx, {
          orgId: e.orgId,
          contactId: e.contactId,
          type: "sequence.send_failed",
          payload: { enrollmentId: e.id, attempts, error: (err as Error).message.slice(0, 200) },
        });
      });
      if (attempts >= 5 && e.contact.assignedAgentId) {
        await this.notify.notify({
          orgId: e.orgId,
          userId: e.contact.assignedAgentId,
          kind: "sequence.attention",
          title: `Sequence stopped: messages failing for ${e.contact.name}`,
          link: `/contacts/${e.contactId}`,
        });
      }
      throw err;
    }
  }

  /** Due/overdue follow-up nudges (once each per follow-up). Runs on the minute sweep. */
  async sweepFollowupNotices() {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60 * 1000);
    const dueSoon = await this.prisma.followup.findMany({
      where: { doneAt: null, dueAt: { lte: soon }, notifiedDueAt: null },
      include: { contact: { select: { name: true } } },
      take: 200,
    });
    for (const f of dueSoon) {
      if (f.assignedAgentId) {
        await this.notify.notify({
          orgId: f.orgId,
          userId: f.assignedAgentId,
          kind: "followup.due",
          title: `Due soon: ${f.title}`,
          body: f.contact.name,
          link: `/contacts/${f.contactId}`,
        });
      }
      await this.prisma.followup.update({ where: { id: f.id }, data: { notifiedDueAt: now } });
    }
    const overdue = await this.prisma.followup.findMany({
      where: { doneAt: null, dueAt: { lt: now }, notifiedOverdueAt: null },
      include: { contact: { select: { name: true } } },
      take: 200,
    });
    for (const f of overdue) {
      if (f.assignedAgentId) {
        await this.notify.notify({
          orgId: f.orgId,
          userId: f.assignedAgentId,
          kind: "followup.overdue",
          title: `Overdue: ${f.title}`,
          body: f.contact.name,
          link: `/followups?view=overdue`,
        });
      }
      await this.prisma.followup.update({ where: { id: f.id }, data: { notifiedOverdueAt: now } });
    }
    return dueSoon.length + overdue.length;
  }

  /** Re-engagement scan: quiet ACTIVE contacts get a manual follow-up. */
  async sweepReengage(inactiveDays: number) {
    const cutoff = new Date(Date.now() - inactiveDays * 86400000);
    const candidates = await this.prisma.contact.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
        followups: { none: { doneAt: null } },
      },
      select: { id: true, orgId: true, name: true, assignedAgentId: true },
      take: 200,
    });
    let created = 0;
    for (const c of candidates) {
      const assignee = c.assignedAgentId
        ? await this.prisma.membership.findUnique({
            where: { orgId_userId: { orgId: c.orgId, userId: c.assignedAgentId } },
          })
        : null;
      const owner = await this.prisma.membership.findFirst({ where: { orgId: c.orgId, role: "OWNER", active: true } });
      const to = assignee?.active ? c.assignedAgentId : owner?.userId ?? null;
      await this.prisma.$transaction(async (tx) => {
        await tx.followup.create({
          data: {
            orgId: c.orgId,
            contactId: c.id,
            title: `Re-engage ${c.name}`,
            dueAt: new Date(Date.now() + 24 * 3600000),
            assignedAgentId: to,
          },
        });
        await logActivity(tx, { orgId: c.orgId, contactId: c.id, type: "contact.reengaged", payload: { inactiveDays } });
      });
      created++;
    }
    return created;
  }

  // -- appointment nudges ----------------------------------------------------

  private apptWhen(a: { date: Date; time: string | null; type: string | null }): string {
    const day = a.date.toISOString().slice(0, 10);
    return `${a.type ?? "appointment"} on ${day}${a.time ? ` at ${a.time}` : ""}`;
  }

  /** Schedule confirm-now, remind-before and follow-up-after nudges. */
  async scheduleAppointmentReminders(appointmentId: string) {
    if (!this.boss) return;
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!a || a.status !== "SCHEDULED") return;
    await this.boss.send(APPT_SEND_QUEUE, { appointmentId, kind: "confirm" }, { startAfter: new Date(Date.now() + 30 * 1000) });
    const remindAt = new Date(a.date.getTime() - 24 * 3600000);
    if (remindAt.getTime() > Date.now() + 5 * 60 * 1000) {
      await this.boss.send(APPT_SEND_QUEUE, { appointmentId, kind: "reminder" }, { startAfter: remindAt });
    }
    await this.boss.send(APPT_FOLLOWUP_QUEUE, { appointmentId }, { startAfter: new Date(a.date.getTime() + 2 * 3600000) });
  }

  private async resolveNumber(orgId: string, contactId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { orgId, contactId, status: "OPEN" },
      include: { number: true },
      orderBy: { updatedAt: "desc" },
    });
    return (
      conv?.number ?? (await this.prisma.whatsappNumber.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } }))
    );
  }

  async sendAppointmentNudge(appointmentId: string, kind: "confirm" | "reminder") {
    if (!appointmentId) return;
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { contact: true },
    });
    if (!a || a.status !== "SCHEDULED" || a.contact.status === "DNC") return;
    const number = await this.resolveNumber(a.orgId, a.contactId);
    if (!number) return;
    const body =
      kind === "reminder"
        ? `Hi ${firstName(a.contact.name)}, reminder: your ${this.apptWhen(a)} is tomorrow. Reply to reschedule.`
        : `Hi ${firstName(a.contact.name)}, confirming your ${this.apptWhen(a)}. Reply to reschedule.`;
    try {
      const sent = await this.sender.sendOutbound({
        phoneNumberId: number.providerNumberId,
        accessToken: decryptToken(number.accessToken),
        to: a.contact.phoneE164,
        body,
        contactName: a.contact.name,
        lastInboundAt: a.contact.lastMessageAt,
      });
      const now = new Date();
      await this.prisma.$transaction(async (tx) => {
        let conversationId = (
          await tx.conversation.findFirst({ where: { orgId: a.orgId, contactId: a.contactId, status: "OPEN" } })
        )?.id;
        if (!conversationId) {
          const created = await tx.conversation.create({
            data: { orgId: a.orgId, contactId: a.contactId, whatsappNumberId: number.id, assignedAgentId: a.contact.assignedAgentId },
          });
          conversationId = created.id;
        }
        await tx.message.create({
          data: {
            orgId: a.orgId,
            conversationId,
            providerMessageId: sent.providerMessageId,
            direction: "OUT",
            type: "text",
            body,
            templateName: sent.via === "template" ? (process.env.WHATSAPP_FALLBACK_TEMPLATE?.trim() || null) : null,
            sentAt: now,
          },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { lastOutboundAt: now, needsReply: false } });
        await logActivity(tx, { orgId: a.orgId, contactId: a.contactId, type: "appointment.reminded", payload: { appointmentId, kind } });
      });
      if (a.assigneeId) {
        await this.notify.notify({
          orgId: a.orgId,
          userId: a.assigneeId,
          kind: "appointment.reminder",
          title: `${kind === "reminder" ? "Reminder" : "Confirmation"} sent to ${a.contact.name}`,
          link: `/appointments?view=today`,
        });
      }
    } catch (e) {
      await logActivity(this.prisma, {
        orgId: a.orgId,
        contactId: a.contactId,
        type: "appointment.send_failed",
        payload: { appointmentId, kind, error: (e as Error).message.slice(0, 200) },
      });
    }
  }

  async postAppointmentFollowup(appointmentId: string) {
    if (!appointmentId) return;
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, include: { contact: true } });
    if (!a || a.status !== "SCHEDULED") return;
    const open = await this.prisma.followup.findFirst({ where: { contactId: a.contactId, doneAt: null, title: { contains: "appointment" } } });
    if (open) return;
    const assignee = a.assigneeId ?? a.contact.assignedAgentId;
    await this.prisma.$transaction(async (tx) => {
      await tx.followup.create({
        data: {
          orgId: a.orgId,
          contactId: a.contactId,
          title: `Post-appointment follow-up with ${a.contact.name}`,
          dueAt: new Date(),
          assignedAgentId: assignee,
        },
      });
      await logActivity(tx, { orgId: a.orgId, contactId: a.contactId, type: "appointment.followup", payload: { appointmentId } });
    });
  }
}

