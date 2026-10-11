import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { PipelinesService } from "./pipelines.service";

function ctx(req: any): ActorCtx {
  return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
}

@Controller("pipelines")
@UseGuards(AuthGuard, OrgGuard)
export class PipelinesController {
  constructor(@Inject(PipelinesService) private readonly pipes: PipelinesService) {}

  @Get()
  list(@Req() req: any) {
    return this.pipes.list(ctx(req));
  }

  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return this.pipes.create(ctx(req), dto);
  }

  @Post("from-template")
  fromTemplate(@Req() req: any, @Body() dto: any) {
    return this.pipes.fromTemplate(ctx(req), dto?.template);
  }

  @Get(":id")
  get(@Req() req: any, @Param("id") id: string) {
    return this.pipes.list(ctx(req)).then((all) => all.find((p) => p.id === id) ?? null);
  }

  @Patch(":id")
  rename(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.pipes.rename(ctx(req), id, dto);
  }

  @Delete(":id")
  remove(@Req() req: any, @Param("id") id: string) {
    return this.pipes.remove(ctx(req), id);
  }

  @Post(":id/stages")
  addStage(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.pipes.addStage(ctx(req), id, dto);
  }

  @Patch(":id/stages/:stageId")
  updateStage(@Req() req: any, @Param("id") id: string, @Param("stageId") stageId: string, @Body() dto: any) {
    return this.pipes.updateStage(ctx(req), id, stageId, dto);
  }

  @Delete(":id/stages/:stageId")
  removeStage(@Req() req: any, @Param("id") id: string, @Param("stageId") stageId: string, @Query("moveTo") moveTo?: string) {
    return this.pipes.removeStage(ctx(req), id, stageId, moveTo);
  }
}

@Controller("contacts/:contactId/pipelines")
@UseGuards(AuthGuard, OrgGuard)
export class EnrollmentsController {
  constructor(@Inject(PipelinesService) private readonly pipes: PipelinesService) {}

  @Get()
  list(@Req() req: any, @Param("contactId") contactId: string) {
    return this.pipes.forContact(ctx(req), contactId);
  }

  @Post()
  enroll(@Req() req: any, @Param("contactId") contactId: string, @Body() dto: any) {
    return this.pipes.enroll(ctx(req), contactId, dto?.pipelineId, dto?.stageId);
  }

  @Patch(":pipelineId")
  move(@Req() req: any, @Param("contactId") contactId: string, @Param("pipelineId") pipelineId: string, @Body() dto: any) {
    return this.pipes.move(ctx(req), contactId, pipelineId, dto?.stageId);
  }

  @Post(":pipelineId/outcome")
  outcome(@Req() req: any, @Param("contactId") contactId: string, @Param("pipelineId") pipelineId: string, @Body() dto: any) {
    return this.pipes.setOutcome(ctx(req), contactId, pipelineId, dto?.outcome, dto?.reason);
  }

  @Delete(":pipelineId")
  unenroll(@Req() req: any, @Param("contactId") contactId: string, @Param("pipelineId") pipelineId: string) {
    return this.pipes.unenroll(ctx(req), contactId, pipelineId);
  }
}
