import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { normalizePhone } from "./phone.util";
import { logActivity } from "./activity";

export interface ActorCtx {
  orgId: string;
  userId: string;
  role: "OWNER" | "AGENT";
}

export interface ListQuery {
  q?: string;
  status?: string;
  tag?: string;
  pipeline?: string;
  stage?: string;
  assigned?: "me" | "all" | string;
  take?: number;
  skip?: number;
}

const STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED", "DNC"] as const;

const detailInclude = {
  tags: { include: { tag: true } },
  notes: { orderBy: { createdAt: "desc" as const }, take: 200 },
  pipelines: { include: { pipeline: { include: { stages: { orderBy: { order: "asc" as const } } } }, stage: true }, orderBy: { enteredAt: "asc" as const } },
} satisfies Prisma.ContactInclude;

export function assertVisible(contact: { assignedAgentId: string | null } | null, ctx: ActorCtx) {
  if (!contact) throw new NotFoundException("Contact not found");
  if (ctx.role === "AGENT" && contact.assignedAgentId !== ctx.userId) {
    throw new ForbiddenException("Agents can only access their assigned contacts");
  }
}

@Injectable()
export class ContactsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private baseWhere(ctx: ActorCtx, q: ListQuery) {
    const where: Prisma.ContactWhereInput = { orgId: ctx.orgId };
    if (ctx.role === "AGENT" || q.assigned === "me") {
      where.assignedAgentId = ctx.role === "AGENT" && q.assigned && q.assigned !== "me" ? q.assigned : ctx.userId;
      if (ctx.role === "OWNER" && q.assigned && q.assigned !== "me" && q.assigned !== "all") {
        where.assignedAgentId = q.assigned;
      }
    } else if (q.assigned && q.assigned !== "all") {
      where.assignedAgentId = q.assigned;
    }
    if (q.status) {
      if (!(STATUSES as readonly string[]).includes(q.status)) throw new BadRequestException("Invalid status");
      where.status = q.status as (typeof STATUSES)[number];
    }
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { name: { contains: s, mode: "insensitive" } },
        { phoneE164: { contains: s.replace(/[\s\-().]/g, "") } },
        { email: { contains: s, mode: "insensitive" } },
      ];
    }
    if (q.tag?.trim()) {
      where.tags = { some: { tag: { name: q.tag.trim() } } };
    }
    if (q.pipeline?.trim() || q.stage?.trim()) {
      where.pipelines = {
        some: {
          ...(q.pipeline?.trim() ? { pipelineId: q.pipeline.trim() } : {}),
          ...(q.stage?.trim() ? { stageId: q.stage.trim() } : {}),
        },
      };
    }
    return where;
  }

  async list(ctx: ActorCtx, q: ListQuery) {
    const take = Math.min(Math.max(Number(q.take) || 50, 1), 200);
    const skip = Math.max(Number(q.skip) || 0, 0);
    const where = this.baseWhere(ctx, q);
    const [total, items] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        include: { tags: { include: { tag: true } } },
        orderBy: { updatedAt: "desc" },
        take,
        skip,
      }),
    ]);
    return { items, total, take, skip };
  }

  private async assertAssignee(ctx: ActorCtx, assignedAgentId?: string | null) {
    if (!assignedAgentId) return;
    const m = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: ctx.orgId, userId: assignedAgentId } },
    });
    if (!m || !m.active) throw new BadRequestException("Assignee must be an active team member");
  }

  private async attachTags(db: Prisma.TransactionClient, orgId: string, contactId: string, names: string[]) {
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const tag = await db.tag.upsert({
        where: { orgId_name: { orgId, name } },
        update: {},
        create: { orgId, name },
      });
      await db.contactTag.upsert({
        where: { contactId_tagId: { contactId, tagId: tag.id } },
        update: {},
        create: { contactId, tagId: tag.id },
      });
    }
  }

  async create(ctx: ActorCtx, dto: any) {
    if (!dto?.name?.trim()) throw new BadRequestException("Name is required");
    const phoneE164 = normalizePhone(dto.phone);
    const existing = await this.prisma.contact.findUnique({
      where: { orgId_phoneE164: { orgId: ctx.orgId, phoneE164 } },
      include: { tags: { include: { tag: true } } },
    });
    if (existing) {
      assertVisible(existing, ctx);
      throw new ConflictException({ message: "Contact with this phone already exists", contact: existing });
    }
    await this.assertAssignee(ctx, dto.assignedAgentId ?? null);
    if (dto.status && !(STATUSES as readonly string[]).includes(dto.status)) {
      throw new BadRequestException("Invalid status");
    }
    const contact = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contact.create({
        data: {
          orgId: ctx.orgId,
          name: dto.name.trim(),
          phoneE164,
          email: dto.email?.trim() || null,
          source: dto.source?.trim() || null,
          referredBy: dto.referredBy?.trim() || null,
          status: dto.status ?? "ACTIVE",
          assignedAgentId: dto.assignedAgentId ?? (ctx.role === "AGENT" ? ctx.userId : null),
          customFields: dto.customFields ?? undefined,
        },
        include: { tags: { include: { tag: true } } },
      });
      if (Array.isArray(dto.tags)) await this.attachTags(tx, ctx.orgId, c.id, dto.tags);
      await logActivity(tx, { orgId: ctx.orgId, contactId: c.id, type: "contact.created", actorId: ctx.userId });
      return c;
    });
    return this.get(ctx, contact.id);
  }

  async get(ctx: ActorCtx, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, orgId: ctx.orgId },
      include: detailInclude,
    });
    assertVisible(contact, ctx);
    return contact;
  }

  async update(ctx: ActorCtx, id: string, dto: any) {
    const current = await this.prisma.contact.findFirst({ where: { id, orgId: ctx.orgId } });
    assertVisible(current, ctx);
    const data: Prisma.ContactUpdateInput = {};
    if (dto.name !== undefined) {
      if (!String(dto.name).trim()) throw new BadRequestException("Name cannot be empty");
      data.name = String(dto.name).trim();
    }
    if (dto.phone !== undefined) {
      const phoneE164 = normalizePhone(dto.phone);
      const dup = await this.prisma.contact.findUnique({
        where: { orgId_phoneE164: { orgId: ctx.orgId, phoneE164 } },
      });
      if (dup && dup.id !== id) {
        throw new ConflictException({ message: "Another contact already uses this phone", contact: dup });
      }
      data.phoneE164 = phoneE164;
    }
    for (const f of ["email", "source", "referredBy"] as const) {
      if (dto[f] !== undefined) data[f] = dto[f]?.trim() || null;
    }
    if (dto.customFields !== undefined) data.customFields = dto.customFields ?? undefined;
    if (dto.nextActionAt !== undefined) data.nextActionAt = dto.nextActionAt ? new Date(dto.nextActionAt) : null;
    if (dto.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(dto.status)) throw new BadRequestException("Invalid status");
      data.status = dto.status;
    }
    if (dto.assignedAgentId !== undefined) {
      await this.assertAssignee(ctx, dto.assignedAgentId);
      data.assignedAgentId = dto.assignedAgentId ?? null;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.contact.update({ where: { id }, data });
      const events: Array<{ type: string; payload?: Prisma.InputJsonValue }> = [{ type: "contact.updated" }];
      if (dto.status !== undefined && dto.status !== current!.status) {
        events.push({ type: "contact.status", payload: { from: current!.status, to: dto.status } });
        if (dto.status === "DNC") events.push({ type: "contact.dnc", payload: { note: "All automated follow-up must stop" } });
      }
      if (dto.assignedAgentId !== undefined && dto.assignedAgentId !== current!.assignedAgentId) {
        events.push({ type: "contact.assigned", payload: { to: dto.assignedAgentId ?? null } });
      }
      for (const e of events) {
        await logActivity(tx, { orgId: ctx.orgId, contactId: id, type: e.type, actorId: ctx.userId, payload: e.payload });
      }
      if (dto.status === "DNC") {
        // Hard stop: no automated follow-up may ever reach this contact again.
        const active = await tx.enrollment.findMany({ where: { contactId: id, status: "ACTIVE" }, select: { id: true } });
        for (const a of active) {
          await tx.enrollment.update({ where: { id: a.id }, data: { status: "STOPPED", stopReason: "dnc", nextRunAt: null } });
          await logActivity(tx, { orgId: ctx.orgId, contactId: id, type: "sequence.stopped", actorId: ctx.userId, payload: { enrollmentId: a.id, reason: "dnc" } });
        }
      }
      return c;
    });
    void updated;
    return this.get(ctx, id);
  }

  async addTag(ctx: ActorCtx, id: string, name: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    if (!name?.trim()) throw new BadRequestException("Tag name required");
    await this.prisma.$transaction(async (tx) => {
      await this.attachTags(tx, ctx.orgId, id, [name]);
      await logActivity(tx, { orgId: ctx.orgId, contactId: id, type: "contact.tag.added", actorId: ctx.userId, payload: { name: name.trim() } });
    });
    return this.get(ctx, id);
  }

  async removeTag(ctx: ActorCtx, id: string, tagId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    await this.prisma.$transaction(async (tx) => {
      await tx.contactTag.deleteMany({ where: { contactId: id, tagId } });
      await logActivity(tx, { orgId: ctx.orgId, contactId: id, type: "contact.tag.removed", actorId: ctx.userId, payload: { tagId } });
    });
    return this.get(ctx, id);
  }

  async addNote(ctx: ActorCtx, id: string, body: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    if (!body?.trim()) throw new BadRequestException("Note body required");
    const note = await this.prisma.$transaction(async (tx) => {
      const n = await tx.note.create({
        data: { orgId: ctx.orgId, contactId: id, authorId: ctx.userId, body: body.trim() },
      });
      await logActivity(tx, { orgId: ctx.orgId, contactId: id, type: "contact.note", actorId: ctx.userId });
      return n;
    });
    return note;
  }

  async activities(ctx: ActorCtx, id: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id, orgId: ctx.orgId } });
    assertVisible(contact, ctx);
    return this.prisma.activity.findMany({
      where: { orgId: ctx.orgId, contactId: id },
      orderBy: { at: "desc" },
      take: 200,
    });
  }

  async merge(ctx: ActorCtx, survivingId: string, mergedId: string) {
    if (!survivingId || !mergedId || survivingId === mergedId) {
      throw new BadRequestException("Two different contact ids are required");
    }
    const [s, m] = await Promise.all([
      this.prisma.contact.findFirst({ where: { id: survivingId, orgId: ctx.orgId }, include: { tags: true } }),
      this.prisma.contact.findFirst({ where: { id: mergedId, orgId: ctx.orgId }, include: { tags: { include: { tag: true } } } }),
    ]);
    if (!s || !m) throw new NotFoundException("Both contacts must exist in this organisation");
    assertVisible(s, ctx);
    assertVisible(m, ctx);
    return this.prisma.$transaction(async (tx) => {
      for (const t of m.tags) {
        await tx.contactTag.upsert({
          where: { contactId_tagId: { contactId: s.id, tagId: t.tagId } },
          update: {},
          create: { contactId: s.id, tagId: t.tagId },
        });
      }
      await tx.note.updateMany({ where: { contactId: m.id }, data: { contactId: s.id } });
      await tx.activity.updateMany({ where: { contactId: m.id }, data: { contactId: s.id } });
      const patch: Prisma.ContactUpdateInput = {};
      if (!s.email && m.email) patch.email = m.email;
      if (!s.source && m.source) patch.source = m.source;
      if (!s.referredBy && m.referredBy) patch.referredBy = m.referredBy;
      if (!s.assignedAgentId && m.assignedAgentId) patch.assignedAgentId = m.assignedAgentId;
      if (m.customFields && typeof m.customFields === "object") {
        patch.customFields = { ...((s.customFields as object) ?? {}), ...(m.customFields as object) };
      }
      if (Object.keys(patch).length) await tx.contact.update({ where: { id: s.id }, data: patch });
      await tx.contactMerge.create({
        data: {
          orgId: ctx.orgId,
          survivingId: s.id,
          mergedId: m.id,
          actorId: ctx.userId,
          snapshot: {
            merged: { id: m.id, name: m.name, phoneE164: m.phoneE164, email: m.email, tags: m.tags.map((t) => t.tag.name) },
          } as Prisma.InputJsonValue,
        },
      });
      await tx.contact.delete({ where: { id: m.id } });
      await logActivity(tx, { orgId: ctx.orgId, contactId: s.id, type: "contact.merged", actorId: ctx.userId, payload: { mergedId: m.id, mergedName: m.name } });
      return tx.contact.findUniqueOrThrow({ where: { id: s.id }, include: detailInclude });
    });
  }

  async importRows(ctx: ActorCtx, rows: any[], dryRun: boolean) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can import contacts");
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException("rows array is required");
    if (rows.length > 1000) throw new BadRequestException("Max 1000 rows per import");
    const report: Array<{ index: number; action: "create" | "update" | "error"; phone?: string; error?: string }> = [];
    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      try {
        if (!String(r.name ?? "").trim()) throw new Error("Name is required");
        const phoneE164 = normalizePhone(r.phone);
        const existing = await this.prisma.contact.findUnique({
          where: { orgId_phoneE164: { orgId: ctx.orgId, phoneE164 } },
        });
        if (dryRun) {
          report.push({ index: i, action: existing ? "update" : "create", phone: phoneE164 });
          continue;
        }
        await this.prisma.$transaction(async (tx) => {
          if (existing) {
            await tx.contact.update({
              where: { id: existing.id },
              data: {
                name: String(r.name).trim(),
                email: r.email?.trim() || undefined,
                source: r.source?.trim() || undefined,
              },
            });
            if (Array.isArray(r.tags)) await this.attachTags(tx, ctx.orgId, existing.id, r.tags);
            await logActivity(tx, { orgId: ctx.orgId, contactId: existing.id, type: "contact.imported", actorId: ctx.userId });
            updated++;
          } else {
            const c = await tx.contact.create({
              data: {
                orgId: ctx.orgId,
                name: String(r.name).trim(),
                phoneE164,
                email: r.email?.trim() || null,
                source: r.source?.trim() || null,
              },
            });
            if (Array.isArray(r.tags)) await this.attachTags(tx, ctx.orgId, c.id, r.tags);
            await logActivity(tx, { orgId: ctx.orgId, contactId: c.id, type: "contact.imported", actorId: ctx.userId });
            created++;
          }
        });
        report.push({ index: i, action: existing ? "update" : "create", phone: phoneE164 });
      } catch (e) {
        report.push({ index: i, action: "error", error: e instanceof Error ? e.message : "Row failed" });
      }
    }
    return { created, updated, errors: report.filter((r) => r.action === "error").length, report };
  }

  async exportCsv(ctx: ActorCtx, q: ListQuery) {
    if (ctx.role !== "OWNER") throw new ForbiddenException("Only owners can export contacts");
    const where = this.baseWhere(ctx, { ...q, assigned: "all" });
    const items = await this.prisma.contact.findMany({
      where,
      include: { tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    const assigneeIds = [...new Set(items.map((c) => c.assignedAgentId).filter(Boolean))] as string[];
    const users = assigneeIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, email: true } })
      : [];
    const emailOf = new Map(users.map((u) => [u.id, u.email]));
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["name,phone,email,source,status,assignedTo,tags"];
    for (const c of items) {
      lines.push(
        [c.name, c.phoneE164, c.email, c.source, c.status, c.assignedAgentId ? emailOf.get(c.assignedAgentId) ?? "" : "", c.tags.map((t) => t.tag.name).join(";")].map(esc).join(","),
      );
    }
    return lines.join("\n");
  }
}
