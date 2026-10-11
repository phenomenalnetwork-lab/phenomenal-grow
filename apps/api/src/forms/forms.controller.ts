import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { FormsService } from "./forms.service";

function ctx(req: any): ActorCtx {
  return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
}

@Controller("forms")
@UseGuards(AuthGuard, OrgGuard)
export class FormsController {
  constructor(@Inject(FormsService) private readonly forms: FormsService) {}

  @Get()
  list(@Req() req: any) {
    return this.forms.list(ctx(req));
  }

  @Post()
  create(@Req() req: any, @Body() dto: any) {
    return this.forms.create(ctx(req), dto);
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.forms.update(ctx(req), id, dto);
  }

  @Delete(":id")
  remove(@Req() req: any, @Param("id") id: string) {
    return this.forms.remove(ctx(req), id);
  }
}

/** Public capture endpoints — no session. Token-gated, active-only. */
@Controller("public/forms")
export class PublicFormsController {
  constructor(@Inject(FormsService) private readonly forms: FormsService) {}

  @Get(":token")
  get(@Param("token") token: string) {
    return this.forms.publicGet(token);
  }

  @Post(":token/submit")
  submit(@Param("token") token: string, @Body() dto: any) {
    return this.forms.submit(token, dto?.values ?? {}, dto?.attribution);
  }
}
