import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { WhatsappService } from "./whatsapp.service";

function ctx(req: any): ActorCtx {
  return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
}

@Controller("whatsapp/numbers")
@UseGuards(AuthGuard, OrgGuard)
export class NumbersController {
  constructor(@Inject(WhatsappService) private readonly wa: WhatsappService) {}

  @Get()
  list(@Req() req: any) {
    return this.wa.listNumbers(ctx(req));
  }

  @Post()
  register(@Req() req: any, @Body() dto: any) {
    return this.wa.registerNumber(ctx(req), dto);
  }

  @Delete(":id")
  remove(@Req() req: any, @Param("id") id: string) {
    return this.wa.removeNumber(ctx(req), id);
  }
}

@Controller("conversations")
@UseGuards(AuthGuard, OrgGuard)
export class ConversationsController {
  constructor(@Inject(WhatsappService) private readonly wa: WhatsappService) {}

  @Get()
  list(@Req() req: any, @Query() q: any) {
    return this.wa.listConversations(ctx(req), String(q.view ?? "recent"), Number(q.take), Number(q.skip));
  }

  @Get(":id")
  get(@Req() req: any, @Param("id") id: string) {
    return this.wa.getConversation(ctx(req), id);
  }

  @Patch(":id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.wa.updateConversation(ctx(req), id, dto);
  }

  @Post(":id/reply")
  reply(@Req() req: any, @Param("id") id: string, @Body() dto: any) {
    return this.wa.reply(ctx(req), id, dto?.text);
  }
}
