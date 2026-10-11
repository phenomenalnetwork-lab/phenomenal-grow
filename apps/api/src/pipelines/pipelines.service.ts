import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { logActivity } from "../contacts/activity";
import { assertVisible, type ActorCtx } from "../contacts/contacts.service";

const TEMPLATES: Record<string, { name: string; type: string; stages: Array<{ name: string; expectedAction?: string; isConversion?: boolean }> }> = {
  business: {
    name: "New Client",
    type: "business",
    stages: [
      { name: "New Enquiry", expectedAction: "Reply" },
      { name: "Qualified", expectedAction: "Follow up" },
      { name: "Consultation", expectedAction: "Schedule appointment" },
      { name: "Proposal", expectedAction: "Send information" },
      { name: "Customer", expectedAction: "Start onboarding", isConversion: true },
    ],
  },
  church: {
    name: "New Visitor",
    type: "church",
    stages: [
      { name: "New Contact", expectedAction: "Reply" },
      { name: "First Response", expectedAction: "Reply" },
      { name: "Personal Follow-up", expectedAction: "Call" },
      { name: "Attended", expectedAction: "Follow up" },
      { name: "Connected", expectedAction: "Start sequence", isConversion: true },
      { name: "Ongoing", expectedAction: "Re-engage" },
    ],
  },
  coach: {
    name: "New Enquiry",
    type: "coach",
    stages: [
      { name: "Enquiry", expectedAction: "Reply" },
      { name: "Consultation", expectedAction: "Schedule appointment" },
      { name: "Programme", expectedAction: "Send information" },
      { name: "Active Client", expectedAction: "Start sequence", isConversion: true },
      { name: "Completed", expectedAction: "Follow up" },
      { name: "Retention", expectedAction: "Re-engage" },
    ],
  },
};

const OUTCOMES = ["ONGOING", "CONVERTED", "NOT_CONVERTED"] as const;

@Injectable()
export class PipelinesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async requireOwner(ctx: ActorCtx) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners manage pipelines");
  }

  private async getPipeline(ctx: ActorCtx, id: string) {
    const p = await this.prisma.pipeline.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    if (!p) throw new NotFoundException("Pipeline not found");
    return p;
  }

  async list(ctx: ActorCtx) {
    const pipes = await this.prisma.pipeline.findMany({
      where: { orgId: ctx.orgId },
      include: { stages: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    const counts = await this.prisma.contactPipeline.groupBy({
      by: ["pipelineId"],
      where: { orgId: ctx.orgId, outcome: "ONGOING" },
      _count: true,
    });
    const active = new Map(counts.map((c) => [c.pipelineId, c._count]));
    return pipes.map((p) => ({ ...p, activeCount: active.get(p.id) ?? 0 }));
  }

  async create(ctx: ActorCtx, dto: any) {
    await this.requireOwner(ctx);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Pipeline name required");
    const stages: string[] = Array.isArray(dto?.stages) ? dto.stages.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    const pipe = await this.prisma.$transaction(async (tx) => {
      const p = await tx.pipeline.create({ data: { orgId: ctx.orgId, name, type: dto?.type?.trim() || "custom" } });
      let order = 0;
      for (const s of stages) {
        await tx.stage.create({ data: { pipelineId: p.id, name: s, order: order++ } });
      }
      await logActivity(tx, { orgId: ctx.orgId, type: "pipeline.created", actorId: ctx.userId, payload: { pipelineId: p.id, name } });
      return p;
    });
    return this.getPipeline(ctx, pipe.id);
  }

  async fromTemplate(ctx: ActorCtx, template: string) {
    const t = TEMPLATES[template];
    if (!t) throw new BadRequestException("Unknown template (business|church|coach)");
    await this.requireOwner(ctx);
    const pipe = await this.prisma.$transaction(async (tx) => {
      const p = await tx.pipeline.create({ data: { orgId: ctx.orgId, name: t.name, type: t.type } });
      let order = 0;
      for (const s of t.stages) {
        await tx.stage.create({
          data: { pipelineId: p.id, name: s.name, order: order++, expectedAction: s.expectedAction ?? null, isConversion: s.isConversion ?? false },
        });
      }
      await logActivity(tx, { orgId: ctx.orgId, type: "pipeline.created", actorId: ctx.userId, payload: { pipelineId: p.id, name: t.name, template } });
      return p;
    });
    return this.getPipeline(ctx, pipe.id);
  }

  async rename(ctx: ActorCtx, id: string, dto: any) {
    await this.requireOwner(ctx);
    const p = await this.getPipeline(ctx, id);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Pipeline name required");
    await this.prisma.pipeline.update({ where: { id: p.id }, data: { name } });
    return this.getPipeline(ctx, id);
  }

  async remove(ctx: ActorCtx, id: string) {
    await this.requireOwner(ctx);
    const p = await this.getPipeline(ctx, id);
    const enrolled = await this.prisma.contactPipeline.count({ where: { pipelineId: id } });
    if (enrolled > 0) throw new ForbiddenException("Remove all contacts from the pipeline first");
    await this.prisma.pipeline.delete({ where: { id: p.id } });
    return { ok: true };
  }

  async addStage(ctx: ActorCtx, id: string, dto: any) {
    await this.requireOwner(ctx);
    const p = await this.getPipeline(ctx, id);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Stage name required");
    const max = p.stages.length ? Math.max(...p.stages.map((s) => s.order)) + 1 : 0;
    const stage = await this.prisma.stage.create({
      data: {
        pipelineId: p.id,
        name,
        order: Number.isInteger(dto?.order) ? dto.order : max,
        expectedAction: dto?.expectedAction?.trim() || null,
        isConversion: dto?.isConversion === true,
      },
    });
    return stage;
  }

  async updateStage(ctx: ActorCtx, id: string, stageId: string, dto: any) {
    await this.requireOwner(ctx);
    const p = await this.getPipeline(ctx, id);
    const stage = p.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Stage not found");
    const data: Prisma.StageUpdateInput = {};
    if (dto.name !== undefined) {
      if (!String(dto.name).trim()) throw new BadRequestException("Stage name cannot be empty");
      data.name = String(dto.name).trim();
    }
    if (dto.order !== undefined) {
      if (!Number.isInteger(dto.order)) throw new BadRequestException("order must be an integer");
      data.order = dto.order;
    }
    if (dto.expectedAction !== undefined) data.expectedAction = dto.expectedAction?.trim() || null;
    if (dto.isConversion !== undefined) data.isConversion = dto.isConversion === true;
    return this.prisma.stage.update({ where: { id: stage.id }, data });
  }

  async removeStage(ctx: ActorCtx, id: string, stageId: string, moveTo?: string) {
    await this.requireOwner(ctx);
    const p = await this.getPipeline(ctx, id);
    const stage = p.stages.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("Stage not found");
    const occupants = await this.prisma.contactPipeline.count({ where: { stageId } });
    if (occupants > 0 && !moveTo) {
      throw new ForbiddenException("Stage has contacts — pass moveTo with a target stage");
    }
    if (occupants > 0) {
      const target = p.stages.find((s) => s.id === moveTo);
      if (!target || target.id === stageId) throw new BadRequestException("Invalid moveTo stage");
      await this.prisma.contactPipeline.updateMany({ where: { stageId }, data: { stageId: target.id } });
    }
    await this.prisma.stage.delete({ where: { id: stage.id } });
    return { ok: true };
  }

  // -- enrollments ---------------------------------------------------------

  private async requireContact(ctx: ActorCtx, contactId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    return contact!;
  }

  async enroll(ctx: ActorCtx, contactId: string, pipelineId: string, stageId?: string) {
    await this.requireContact(ctx, contactId);
    const p = await this.getPipeline(ctx, pipelineId);
    if (p.stages.length === 0) throw new BadRequestException("Pipeline has no stages");
    const stage = stageId ? p.stages.find((s) => s.id === stageId) : [...p.stages].sort((a, b) => a.order - b.order)[0];
    if (!stage) throw new BadRequestException("Invalid stage");
    const existing = await this.prisma.contactPipeline.findUnique({
      where: { contactId_pipelineId: { contactId, pipelineId: p.id } },
    });
    if (existing) throw new BadRequestException("Contact is already in this pipeline");
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const e = await tx.contactPipeline.create({
        data: { orgId: ctx.orgId, contactId, pipelineId: p.id, stageId: stage.id },
        include: { pipeline: true, stage: true },
      });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId,
        type: "contact.pipeline.enrolled",
        actorId: ctx.userId,
        payload: { pipelineId: p.id, pipeline: p.name, stage: stage.name },
      });
      return e;
    });
    return enrollment;
  }

  async move(ctx: ActorCtx, contactId: string, pipelineId: string, stageId: string) {
    await this.requireContact(ctx, contactId);
    const p = await this.getPipeline(ctx, pipelineId);
    const stage = p.stages.find((s) => s.id === stageId);
    if (!stage) throw new BadRequestException("Stage does not belong to this pipeline");
    const enrollment = await this.prisma.contactPipeline.findUnique({
      where: { contactId_pipelineId: { contactId, pipelineId: p.id } },
      include: { stage: true },
    });
    if (!enrollment) throw new NotFoundException("Contact is not in this pipeline");
    if (enrollment.stageId === stage.id) return enrollment;
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.contactPipeline.update({
        where: { id: enrollment.id },
        data: {
          stageId: stage.id,
          ...(stage.isConversion ? { outcome: "CONVERTED", convertedAt: new Date(), outcomeReason: null } : {}),
        },
        include: { pipeline: true, stage: true },
      });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId,
        type: stage.isConversion ? "contact.converted" : "contact.pipeline.moved",
        actorId: ctx.userId,
        payload: { pipelineId: p.id, pipeline: p.name, from: enrollment.stage.name, to: stage.name },
      });
      return e;
    });
    return updated;
  }

  async setOutcome(ctx: ActorCtx, contactId: string, pipelineId: string, outcome: string, reason?: string) {
    await this.requireContact(ctx, contactId);
    if (!(OUTCOMES as readonly string[]).includes(outcome)) throw new BadRequestException("Invalid outcome");
    const enrollment = await this.prisma.contactPipeline.findUnique({
      where: { contactId_pipelineId: { contactId, pipelineId } },
    });
    if (!enrollment || enrollment.orgId !== ctx.orgId) throw new NotFoundException("Contact is not in this pipeline");
    const updated = await this.prisma.$transaction(async (tx) => {
      const e = await tx.contactPipeline.update({
        where: { id: enrollment.id },
        data: {
          outcome: outcome as (typeof OUTCOMES)[number],
          outcomeReason: reason?.trim() || null,
          convertedAt: outcome === "CONVERTED" ? new Date() : null,
        },
        include: { pipeline: true, stage: true },
      });
      await logActivity(tx, {
        orgId: ctx.orgId,
        contactId,
        type: outcome === "CONVERTED" ? "contact.converted" : outcome === "NOT_CONVERTED" ? "contact.not_converted" : "contact.reopened",
        actorId: ctx.userId,
        payload: { pipelineId, outcome, reason: reason?.trim() || null },
      });
      return e;
    });
    return updated;
  }

  async unenroll(ctx: ActorCtx, contactId: string, pipelineId: string) {
    await this.requireContact(ctx, contactId);
    const enrollment = await this.prisma.contactPipeline.findUnique({
      where: { contactId_pipelineId: { contactId, pipelineId } },
    });
    if (!enrollment || enrollment.orgId !== ctx.orgId) throw new NotFoundException("Contact is not in this pipeline");
    await this.prisma.$transaction(async (tx) => {
      await tx.contactPipeline.delete({ where: { id: enrollment.id } });
      await logActivity(tx, { orgId: ctx.orgId, contactId, type: "contact.pipeline.removed", actorId: ctx.userId, payload: { pipelineId } });
    });
    return { ok: true };
  }

  async forContact(ctx: ActorCtx, contactId: string) {
    await this.requireContact(ctx, contactId);
    return this.prisma.contactPipeline.findMany({
      where: { contactId },
      include: { pipeline: { include: { stages: { orderBy: { order: "asc" } } } }, stage: true },
      orderBy: { enteredAt: "asc" },
    });
  }
}
