import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { SequencesService } from "./sequences.service";
import { FollowupsService } from "./followups.service";
import { SequencesEngine } from "./engine";

function ctx(req: any): ActorCtx {
  return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
}

@Controller("sequences")
@UseGuards(AuthGuard, OrgGuard)
export class SequencesController {
  constructor(@Inject(SequencesService) private readonly seq: SequencesService) {}

  @Get()
  list(@Req() req: any) {
    return this.seq.list(ctx(req));
  }

  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return this.seq.create(ctx(req), dto);
  }

  @Post("from-template")
  fromTemplate(@Req() req: any, @Body() dto: any) {
    return this.seq.fromTemplate(ctx(req), dto?.template);
  }

  @Delete(":id")
  remove(@Req() req: any, @Param("id") id: string) {
    return this.seq.remove(ctx(req), id);
  }

  @Get(":id/enrollments")
  enrollments(@Req() req: any, @Param("id") id: string, @Query("status") status?: string) {
    return this.seq.enrollments(ctx(req), id, status);
  }
}

@Controller("contacts/:contactId/enrollments")
@UseGuards(AuthGuard, OrgGuard)
export class ContactEnrollmentsController {
  constructor(@Inject(SequencesService) private readonly seq: SequencesService) {}

  @Get()
  list(@Req() req: any, @Param("contactId") contactId: string) {
    return this.seq.forContact(ctx(req), contactId);
  }

  @Post()
  enroll(@Req() req: any, @Param("contactId") contactId: string, @Body() dto: any) {
    return this.seq.enroll(ctx(req), contactId, dto?.sequenceId);
  }
}

@Controller("enrollments")
@UseGuards(AuthGuard, OrgGuard)
export class EnrollmentsController {
  constructor(@Inject(SequencesService) private readonly seq: SequencesService) {}

  @Patch(":id")
  setStatus(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.seq.setStatus(ctx(req), id, dto?.action);
  }
}

@Controller("followups")
@UseGuards(AuthGuard, OrgGuard)
export class FollowupsController {
  constructor(@Inject(FollowupsService) private readonly fu: FollowupsService) {}

  @Get()
  list(@Req() req: any, @Query("view") view?: string) {
    return this.fu.list(ctx(req), view ?? "today");
  }

  @Post("contact/:contactId")
  create(@Req() req: any, @Param("contactId") contactId: string, @Body() dto: any) {
    return this.fu.create(ctx(req), contactId, dto);
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.fu.update(ctx(req), id, dto);
  }
}

@Controller("reengagement")
@UseGuards(AuthGuard, OrgGuard)
export class ReengagementController {
  constructor(@Inject(SequencesEngine) private readonly engine: SequencesEngine) {}

  @Post("scan")
  scan(@Req() req: any, @Body() dto: any) {
    const days = Math.min(Math.max(Number(dto?.inactiveDays) || 30, 1), 365);
    return this.engine.sweepReengage(days).then((created) => ({ created }));
  }
}
