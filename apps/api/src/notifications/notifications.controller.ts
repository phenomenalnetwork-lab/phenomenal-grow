import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(AuthGuard, OrgGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notes: NotificationsService) {}

  private scope(req: any) {
    return { orgId: req.membership.orgId as string, userId: req.user.id as string };
  }

  @Get()
  list(@Req() req: any, @Query("take") take?: string) {
    const { orgId, userId } = this.scope(req);
    return this.notes.list(orgId, userId, take ? Number(take) : 50);
  }

  @Patch(":id/read")
  read(@Req() req: any, @Param("id") id: string) {
    const { orgId, userId } = this.scope(req);
    return this.notes.markRead(orgId, userId, id);
  }

  @Post("read-all")
  readAll(@Req() req: any) {
    const { orgId, userId } = this.scope(req);
    return this.notes.markAllRead(orgId, userId);
  }

  @Get("preferences")
  prefs(@Req() req: any) {
    const { orgId, userId } = this.scope(req);
    return this.notes.preferences(orgId, userId);
  }

  @Post("preferences")
  setPref(@Req() req: any, @Body() dto: any) {
    const { orgId, userId } = this.scope(req);
    return this.notes.setPreference(orgId, userId, String(dto?.kind ?? ""), dto?.enabled !== false);
  }

  @Post("push/subscriptions")
  subscribe(@Req() req: any, @Body() dto: any) {
    return this.notes.saveSubscription(req.user.id, String(dto?.endpoint ?? ""), dto?.keys);
  }

  @Get("push/public-key")
  publicKey() {
    const key = process.env.VAPID_PUBLIC_KEY ?? "";
    return { key: key || null };
  }

  @Delete("push/subscriptions")
  unsubscribe(@Req() req: any, @Body() dto: any) {
    return this.notes.removeSubscription(req.user.id, String(dto?.endpoint ?? ""));
  }
}
