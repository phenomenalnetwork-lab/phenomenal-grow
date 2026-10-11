import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { logActivity } from "../contacts/activity";
import { normalizePhone } from "../contacts/phone.util";
import type { ActorCtx } from "../contacts/contacts.service";
import { PipelinesService } from "../pipelines/pipelines.service";
import { SequencesService } from "../sequences/sequences.service";

export interface FormField {
  key: string;
  label: string;
  type: "text" | "phone" | "email" | "textarea";
  required?: boolean;
}

const SYSTEM: ActorCtx = { orgId: "", userId: "system", role: "OWNER" };

@Injectable()
export class FormsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PipelinesService) private readonly pipes: PipelinesService,
    @Inject(SequencesService) private readonly seqs: SequencesService,
  ) {}

  private async requireOwner(ctx: ActorCtx) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners manage capture forms");
  }

  private cleanFields(raw: unknown): FormField[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException("At least one field is required");
    if (raw.length > 20) throw new BadRequestException("Max 20 fields");
    return raw.map((f: any) => {
      const key = String(f?.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
      const label = String(f?.label ?? "").trim();
      if (!key || !label) throw new BadRequestException("Each field needs a key and label");
      if (!["text", "phone", "email", "textarea"].includes(f?.type)) throw new BadRequestException(`Bad field type for ${key}`);
      return { key, label, type: f.type, required: f?.required === true };
    });
  }

  private async checkRefs(orgId: string, dto: any) {
    if (dto.pipelineId) {
      const p = await this.prisma.pipeline.findFirst({ where: { id: dto.pipelineId, orgId } });
      if (!p) throw new BadRequestException("Unknown pipeline");
      if (dto.stageId && !p) throw new BadRequestException("Unknown stage");
      if (dto.stageId) {
        const s = await this.prisma.stage.findFirst({ where: { id: dto.stageId, pipelineId: dto.pipelineId } });
        if (!s) throw new BadRequestException("Stage does not belong to the pipeline");
      }
    } else if (dto.stageId) {
      throw new BadRequestException("stageId needs a pipelineId");
    }
    if (dto.assigneeId) {
      const m = await this.prisma.membership.findUnique({ where: { orgId_userId: { orgId, userId: dto.assigneeId } } });
      if (!m || !m.active) throw new BadRequestException("Assignee must be an active team member");
    }
    if (dto.sequenceId) {
      const s = await this.prisma.sequence.findFirst({ where: { id: dto.sequenceId, orgId } });
      if (!s) throw new BadRequestException("Unknown sequence");
    }
  }

  async list(ctx: ActorCtx) {
    return this.prisma.captureForm.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "asc" } });
  }

  async create(ctx: ActorCtx, dto: any) {
    await this.requireOwner(ctx);
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Form name required");
    const fields = this.cleanFields(dto?.fields);
    await this.checkRefs(ctx.orgId, dto);
    const form = await this.prisma.captureForm.create({
      data: {
        orgId: ctx.orgId,
        name,
        fields: fields as unknown as Prisma.InputJsonValue,
        source: dto?.source?.trim() || "Website",
        pipelineId: dto?.pipelineId ?? null,
        stageId: dto?.stageId ?? null,
        assigneeId: dto?.assigneeId ?? null,
        sequenceId: dto?.sequenceId ?? null,
      },
    });
    await logActivity(this.prisma, { orgId: ctx.orgId, type: "form.created", actorId: ctx.userId, payload: { formId: form.id, name } });
    return form;
  }

  async update(ctx: ActorCtx, id: string, dto: any) {
    await this.requireOwner(ctx);
    const form = await this.prisma.captureForm.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!form) throw new NotFoundException("Form not found");
    const data: Prisma.CaptureFormUpdateInput = {};
    if (dto.name !== undefined) {
      if (!String(dto.name).trim()) throw new BadRequestException("Name cannot be empty");
      data.name = String(dto.name).trim();
    }
    if (dto.fields !== undefined) data.fields = this.cleanFields(dto.fields) as unknown as Prisma.InputJsonValue;
    if (dto.source !== undefined) data.source = dto.source?.trim() || "Website";
    const refs = { pipelineId: dto.pipelineId ?? form.pipelineId, stageId: dto.stageId ?? form.stageId, assigneeId: dto.assigneeId ?? form.assigneeId, sequenceId: dto.sequenceId ?? form.sequenceId };
    await this.checkRefs(ctx.orgId, refs);
    if (dto.pipelineId !== undefined) data.pipelineId = dto.pipelineId ?? null;
    if (dto.stageId !== undefined) data.stageId = dto.stageId ?? null;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId ?? null;
    if (dto.sequenceId !== undefined) data.sequenceId = dto.sequenceId ?? null;
    if (dto.active !== undefined) data.active = dto.active === true;
    return this.prisma.captureForm.update({ where: { id }, data });
  }

  async remove(ctx: ActorCtx, id: string) {
    await this.requireOwner(ctx);
    const form = await this.prisma.captureForm.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!form) throw new NotFoundException("Form not found");
    await this.prisma.captureForm.delete({ where: { id } });
    return { ok: true };
  }

  async publicGet(token: string) {
    const form = await this.prisma.captureForm.findUnique({ where: { token } });
    if (!form || !form.active) throw new NotFoundException("Form not available");
    const { ...pub } = form;
    void pub;
    return { id: form.id, name: form.name, fields: form.fields };
  }

  /** Public submission: capture → journey. Never creates duplicates. */
  async submit(token: string, values: Record<string, unknown>, attribution?: Record<string, unknown>) {
    const form = await this.prisma.captureForm.findUnique({ where: { token } });
    if (!form || !form.active) throw new NotFoundException("Form not available");
    const fields = form.fields as unknown as FormField[];
    const get = (key: string) => {
      const v = values?.[key];
      return typeof v === "string" ? v.trim() : "";
    };
    const name = get("name");
    if (!name) throw new BadRequestException("Name is required");
    const phone = normalizePhone(get("phone"));
    const email = get("email") || undefined;
    for (const f of fields) {
      if (f.required && !get(f.key)) throw new BadRequestException(`${f.label} is required`);
    }
    const custom: Record<string, string> = {};
    for (const f of fields) {
      if (["name", "phone", "email"].includes(f.key)) continue;
      const v = get(f.key);
      if (v) custom[f.key] = v;
    }
    const sys: ActorCtx = { ...SYSTEM, orgId: form.orgId };
    const contact = await this.prisma.$transaction(async (tx) => {
      let c = await tx.contact.findUnique({ where: { orgId_phoneE164: { orgId: form.orgId, phoneE164: phone } } });
      if (!c) {
        c = await tx.contact.create({
          data: {
            orgId: form.orgId,
            name,
            phoneE164: phone,
            email: email || null,
            source: form.source,
            customFields: (Object.keys(custom).length ? custom : undefined) as Prisma.InputJsonValue | undefined,
            attribution: (attribution && Object.keys(attribution).length ? attribution : undefined) as Prisma.InputJsonValue | undefined,
            assignedAgentId: form.assigneeId,
            status: "ACTIVE",
          },
        });
        await logActivity(tx, { orgId: form.orgId, contactId: c.id, type: "contact.created", payload: { via: "form", form: form.name } });
      } else {
        const patch: Prisma.ContactUpdateInput = {};
        if (c.status === "INACTIVE" || c.status === "ARCHIVED") patch.status = "ACTIVE";
        if (Object.keys(custom).length) patch.customFields = { ...((c.customFields as object) ?? {}), ...custom };
        if (Object.keys(patch).length) c = await tx.contact.update({ where: { id: c.id }, data: patch });
        await logActivity(tx, { orgId: form.orgId, contactId: c.id, type: "contact.capture", payload: { via: "form", form: form.name } });
      }
      return c;
    });
    if (form.pipelineId) {
      try {
        await this.pipes.enroll(sys, contact.id, form.pipelineId, form.stageId ?? undefined);
      } catch {
        // Already enrolled — keep the submission successful.
      }
    }
    if (form.sequenceId) {
      try {
        await this.seqs.enroll(sys, contact.id, form.sequenceId);
      } catch {
        // Already enrolled — keep the submission successful.
      }
    }
    return { ok: true, contactId: contact.id };
  }
}
