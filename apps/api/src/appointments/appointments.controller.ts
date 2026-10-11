import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { AppointmentsService } from "./appointments.service";

function ctx(req: any): ActorCtx {
  return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
}

@Controller("appointments")
@UseGuards(AuthGuard, OrgGuard)
export class AppointmentsController {
  constructor(@Inject(AppointmentsService) private readonly appts: AppointmentsService) {}

  @Get()
  list(@Req() req: any, @Query() q: any) {
    return this.appts.list(ctx(req), String(q.view ?? "today"), q.date);
  }

  @Post("contact/:contactId")
  create(@Req() req: any, @Param("contactId") contactId: string, @Body() dto: any) {
    return this.appts.create(ctx(req), contactId, dto);
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.appts.update(ctx(req), id, dto);
  }
}
