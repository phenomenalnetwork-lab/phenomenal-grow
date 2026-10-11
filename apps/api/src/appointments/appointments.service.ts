import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { logActivity } from "../contacts/activity";
import { assertVisible, type ActorCtx } from "../contacts/contacts.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { SequencesEngine } from "../sequences/engine";

const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED", "NOSHOW"] as const;

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PipelinesService) private readonly pipes: PipelinesService,
    @Inject(SequencesEngine) private readonly engine: SequencesEngine,
    @Inject(NotificationsService) private readonly notify: NotificationsService,
  ) {}

  private scope(ctx: ActorCtx): Prisma.AppointmentWhereInput {
    return ctx.role === "AGENT" ? { OR: [{ assigneeId: ctx.userId }, { contact: { assignedAgentId: ctx.userId } }] } : {};
  }

  async list(ctx: ActorCtx, view: string, date?: string) {
    const where: Prisma.AppointmentWhereInput = { orgId: ctx.orgId, ...this.scope(ctx) };
    const now = new Date();
    const sod = new Date(now);
    sod.setHours(0, 0, 0, 0);
    const eod = new Date(now);
    eod.setHours(23, 59, 59, 999);
    if (view === "today") {
      where.date = { gte: sod, lte: eod };
      where.status = "SCHEDULED";
    } else if (view === "upcoming") {
      where.date = { gt: eod };
      where.status = "SCHEDULED";
    } else if (view === "mine") {
      where.assigneeId = ctx.userId;
    } else if (view && view !== "all") {
      throw new ForbiddenException("Unknown view (today|upcoming|mine|all)");
    }
    if (date) {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date");
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      const e = new Date(d);
      e.setHours(23, 59, 59, 999);
      where.date = { gte: s, lte: e };
    }
    return this.prisma.appointment.findMany({
      where,
      include: { contact: { select: { id: true, name: true, phoneE164: true } } },
      orderBy: [{ date: "asc" }, { time: "asc" }],
      take: 200,
    });
  }

  async create(ctx: ActorCtx, contactId: string, dto: any) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    const date = dto?.date ? new Date(dto.date) : null;
    if (!date || Number.isNaN(date.getTime())) throw new BadRequestException("Valid date is required");
    let assignee: string | null = dto?.assigneeId ?? (ctx.role === "AGENT" ? ctx.userId : contact!.assignedAgentId);
    if (assignee) {
      const m = await this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: ctx.orgId, userId: assignee } },
      });
      if (!m || !m.active) throw new BadRequestException("Assignee must be an active team member");
    }
    const appt = await this.prisma.$transaction(async (tx) => {
      const a = await tx.appointment.create({
        data: {
          orgId: ctx.orgId,
          contactId,
          date,
          time: dto?.time?.trim() || null,
          type: dto?.type?.trim() || null,
          assigneeId: assignee,
          notes: dto?.notes?.trim() || null,
        },
        include: { contact: { select: { id: true, name: true, phoneE164: true } } },
      });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId,
        type: "appointment.scheduled",
        actorId: ctx.userId,
        payload: { appointmentId: a.id, date: date.toISOString().slice(0, 10), time: a.time, type: a.type },
      });
      // Booking moves the journey and halts standard sequences (human takes over).
      if (dto?.pipelineId) {
        const enrollment = await tx.contactPipeline.findUnique({
          where: { contactId_pipelineId: { contactId, pipelineId: dto.pipelineId } },
        });
        if (enrollment && dto?.stageId) {
          const stage = await tx.stage.findFirst({ where: { id: dto.stageId, pipelineId: dto.pipelineId } });
          if (!stage) throw new BadRequestException("Stage does not belong to the pipeline");
          await tx.contactPipeline.update({ where: { id: enrollment.id }, data: { stageId: stage.id } });
          await logActivity(tx, {
            orgId: ctx.orgId,
            contactId,
            type: "contact.pipeline.moved",
            actorId: ctx.userId,
            payload: { pipelineId: dto.pipelineId, to: stage.name, via: "appointment" },
          });
        }
      }
      await this.pipes.haltStandardSequences(tx, ctx.orgId, contactId, ctx.userId, "appointment-booked");
      return a;
    });
    // Nudges (confirm now, remind before, follow up after) — best effort.
    this.engine.scheduleAppointmentReminders(appt.id).catch(() => undefined);
    if (assignee && assignee !== ctx.userId) {
      await this.notify.notify({
        orgId: ctx.orgId,
        userId: assignee,
        kind: "appointment.scheduled",
        title: `Appointment booked for ${contact!.name}`,
        body: `${date.toISOString().slice(0, 10)}${appt.time ? ` ${appt.time}` : ""}`,
        link: `/appointments?view=mine`,
      });
    }
    return appt;
  }

  async update(ctx: ActorCtx, id: string, dto: any) {
    const appt = await this.prisma.appointment.findFirst({ where: { id, orgId: ctx.orgId }, include: { contact: true } });
    if (!appt) throw new NotFoundException("Appointment not found");
    assertVisible(appt.contact, ctx);
    const data: Prisma.AppointmentUpdateInput = {};
    if (dto.date !== undefined) {
      const d = new Date(dto.date);
      if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date");
      data.date = d;
    }
    for (const f of ["time", "type", "notes"] as const) {
      if (dto[f] !== undefined) data[f] = dto[f]?.trim() || null;
    }
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId) {
        const m = await this.prisma.membership.findUnique({
          where: { orgId_userId: { orgId: ctx.orgId, userId: dto.assigneeId } },
        });
        if (!m || !m.active) throw new BadRequestException("Assignee must be an active team member");
        data.assigneeId = dto.assigneeId;
      } else {
        data.assigneeId = null;
      }
    }
    if (dto.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(dto.status)) throw new BadRequestException("Invalid status");
      data.status = dto.status;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.appointment.update({ where: { id }, data });
      if (dto.status !== undefined && dto.status !== appt.status) {
        const type =
          dto.status === "COMPLETED"
            ? "appointment.completed"
            : dto.status === "CANCELLED"
              ? "appointment.cancelled"
              : dto.status === "NOSHOW"
                ? "appointment.no_show"
                : "appointment.rescheduled";
        await logActivity(tx, { orgId: ctx.orgId, contactId: appt.contactId, type, actorId: ctx.userId, payload: { appointmentId: id } });
      }
      return u;
    });
    return updated;
  }
}
