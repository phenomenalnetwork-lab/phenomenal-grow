import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { logActivity } from "../contacts/activity";
import { assertVisible, type ActorCtx } from "../contacts/contacts.service";
import { SequencesEngine } from "./engine";

const TEMPLATES: Record<string, { name: string; postConversion?: boolean; steps: Array<{ dayOffset: number; body: string }> }> = {
  "new-lead": {
    name: "New Lead Follow-up",
    steps: [
      { dayOffset: 0, body: "Hi {{name}}, thanks for reaching out! How can I help you today?" },
      { dayOffset: 2, body: "Hi {{name}}, just checking in — did you get the information you needed?" },
      { dayOffset: 5, body: "Hi {{name}}, happy to answer any questions whenever you're ready. What would help you decide?" },
    ],
  },
  visitor: {
    name: "New Visitor Follow-up",
    steps: [
      { dayOffset: 0, body: "Hi {{name}}, it was great to meet you! Hope you felt welcome." },
      { dayOffset: 2, body: "Hi {{name}}, how did you find your visit? We'd love to see you again." },
      { dayOffset: 7, body: "Hi {{name}}, you're warmly invited again this week — let me know if I can help with anything." },
    ],
  },
  appointment: {
    name: "Appointment Follow-up",
    steps: [
      { dayOffset: 0, body: "Hi {{name}}, your appointment is booked. Let me know if you need to reschedule." },
      { dayOffset: 1, body: "Hi {{name}}, looking forward to seeing you tomorrow!" },
    ],
  },
  unresponsive: {
    name: "Unresponsive Contact",
    steps: [
      { dayOffset: 3, body: "Hi {{name}}, just floating this to the top in case you missed it." },
      { dayOffset: 10, body: "Hi {{name}}, should I keep you on my list, or is now not the right time?" },
      { dayOffset: 21, body: "Hi {{name}}, last check-in from me — reply anytime and I'll pick right up." },
    ],
  },
  customer: {
    name: "Customer Follow-up",
    postConversion: true,
    steps: [
      { dayOffset: 1, body: "Hi {{name}}, welcome aboard! Here's what happens next…" },
      { dayOffset: 7, body: "Hi {{name}}, how are things going so far? Anything I can help with?" },
    ],
  },
  event: {
    name: "Event Follow-up",
    postConversion: true,
    steps: [
      { dayOffset: 1, body: "Hi {{name}}, thanks for attending! Hope it was worthwhile." },
      { dayOffset: 5, body: "Hi {{name}}, we'd love your feedback — and to see you at the next one." },
    ],
  },
};

@Injectable()
export class SequencesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SequencesEngine) private readonly engine: SequencesEngine,
  ) {}

  private async requireOwner(ctx: ActorCtx) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners manage sequences");
  }

  async list(ctx: ActorCtx) {
    return this.prisma.sequence.findMany({
      where: { orgId: ctx.orgId },
      include: { steps: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(ctx: ActorCtx, dto: any) {
    await this.requireOwner(ctx);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Sequence name required");
    const steps: Array<{ dayOffset: number; body: string }> = Array.isArray(dto?.steps) ? dto.steps : [];
    if (steps.length === 0) throw new BadRequestException("At least one step is required");
    const seq = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sequence.create({
        data: { orgId: ctx.orgId, name, kind: "CUSTOM", postConversion: dto?.postConversion === true },
      });
      let order = 0;
      for (const st of steps) {
        if (!String(st.body ?? "").trim()) throw new BadRequestException("Step body required");
        const off = Number(st.dayOffset);
        if (!Number.isInteger(off) || off < 0) throw new BadRequestException("dayOffset must be a non-negative integer");
        await tx.sequenceStep.create({ data: { sequenceId: s.id, dayOffset: off, order: order++, body: String(st.body).trim() } });
      }
      await logActivity(tx, { orgId: ctx.orgId, type: "sequence.created", actorId: ctx.userId, payload: { sequenceId: s.id, name } });
      return s;
    });
    return this.prisma.sequence.findUniqueOrThrow({ where: { id: seq.id }, include: { steps: { orderBy: { order: "asc" } } } });
  }

  async fromTemplate(ctx: ActorCtx, template: string) {
    const t = TEMPLATES[template];
    if (!t) throw new BadRequestException("Unknown template (new-lead|visitor|appointment|unresponsive|customer|event)");
    await this.requireOwner(ctx);
    const seq = await this.prisma.$transaction(async (tx) => {
      const s = await tx.sequence.create({
        data: { orgId: ctx.orgId, name: t.name, kind: "GUIDED", postConversion: t.postConversion ?? false },
      });
      let order = 0;
      for (const st of t.steps) {
        await tx.sequenceStep.create({ data: { sequenceId: s.id, dayOffset: st.dayOffset, order: order++, body: st.body } });
      }
      await logActivity(tx, { orgId: ctx.orgId, type: "sequence.created", actorId: ctx.userId, payload: { sequenceId: s.id, name: t.name, template } });
      return s;
    });
    return this.prisma.sequence.findUniqueOrThrow({ where: { id: seq.id }, include: { steps: { orderBy: { order: "asc" } } } });
  }

  async remove(ctx: ActorCtx, id: string) {
    await this.requireOwner(ctx);
    const s = await this.prisma.sequence.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!s) throw new NotFoundException("Sequence not found");
    const active = await this.prisma.enrollment.count({ where: { sequenceId: id, status: "ACTIVE" } });
    if (active > 0) throw new ForbiddenException("Stop active enrollments first");
    await this.prisma.sequence.delete({ where: { id } });
    return { ok: true };
  }

  async enrollments(ctx: ActorCtx, sequenceId: string, status?: string) {
    const s = await this.prisma.sequence.findFirst({ where: { id: sequenceId, orgId: ctx.orgId } });
    if (!s) throw new NotFoundException("Sequence not found");
    return this.prisma.enrollment.findMany({
      where: { sequenceId, ...(status ? { status: status as never } : {}) },
      include: { contact: { select: { id: true, name: true, phoneE164: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
  }

  async enroll(ctx: ActorCtx, contactId: string, sequenceId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    const seq = await this.prisma.sequence.findFirst({
      where: { id: sequenceId, orgId: ctx.orgId },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!seq || !seq.active) throw new NotFoundException("Active sequence not found");
    if (seq.steps.length === 0) throw new BadRequestException("Sequence has no steps");
    const dup = await this.prisma.enrollment.findFirst({ where: { sequenceId, contactId, status: "ACTIVE" } });
    if (dup) throw new BadRequestException("Contact is already actively enrolled");
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const first = seq.steps[0];
      const e = await tx.enrollment.create({
        data: {
          orgId: ctx.orgId,
          sequenceId,
          contactId,
          nextRunAt: new Date(Date.now() + Math.max(first.dayOffset, 0) * 86400000 + 30 * 1000),
        },
      });
      await logActivity(tx, { orgId: ctx.orgId, contactId, type: "sequence.enrolled", actorId: ctx.userId, payload: { enrollmentId: e.id, sequence: seq.name } });
      return e;
    });
    await this.engine.sweepDue().catch(() => undefined);
    return enrollment;
  }

  async setStatus(ctx: ActorCtx, id: string, action: string) {
    const e = await this.prisma.enrollment.findFirst({ where: { id, orgId: ctx.orgId }, include: { contact: true } });
    if (!e) throw new NotFoundException("Enrollment not found");
    assertVisible(e.contact, ctx);
    if (action === "stop") {
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.update({ where: { id }, data: { status: "STOPPED", stopReason: "manual", nextRunAt: null } });
        await logActivity(tx, { orgId: ctx.orgId, contactId: e.contactId, type: "sequence.stopped", actorId: ctx.userId, payload: { enrollmentId: id } });
      });
    } else if (action === "pause") {
      if (e.status !== "ACTIVE") throw new BadRequestException("Only active enrollments can pause");
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.update({ where: { id }, data: { status: "PAUSED", nextRunAt: null } });
        await logActivity(tx, { orgId: ctx.orgId, contactId: e.contactId, type: "sequence.paused", actorId: ctx.userId, payload: { enrollmentId: id } });
      });
    } else if (action === "resume") {
      if (e.status !== "PAUSED") throw new BadRequestException("Only paused enrollments can resume");
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.update({ where: { id }, data: { status: "ACTIVE", nextRunAt: new Date(Date.now() + 60 * 1000) } });
        await logActivity(tx, { orgId: ctx.orgId, contactId: e.contactId, type: "sequence.resumed", actorId: ctx.userId, payload: { enrollmentId: id } });
      });
    } else {
      throw new BadRequestException("Unknown action (pause|resume|stop)");
    }
    return this.prisma.enrollment.findUniqueOrThrow({ where: { id } });
  }

  async forContact(ctx: ActorCtx, contactId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    return this.prisma.enrollment.findMany({
      where: { contactId },
      include: { sequence: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}
