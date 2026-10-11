import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { HomeService } from "./home.service";

@Controller("home")
@UseGuards(AuthGuard, OrgGuard)
export class HomeController {
  constructor(@Inject(HomeService) private readonly home: HomeService) {}

  @Get()
  dashboard(@Req() req: any) {
    const ctx: ActorCtx = { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
    return this.home.dashboard(ctx);
  }
}
