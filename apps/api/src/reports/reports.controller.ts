import { Controller, Get, Header, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import type { ActorCtx } from "../contacts/contacts.service";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(AuthGuard, OrgGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  private ctx(req: any): ActorCtx {
    return { orgId: req.membership.orgId, userId: req.user.id, role: req.membership.role };
  }

  @Get("overview")
  overview(@Req() req: any, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.overview(this.ctx(req), from, to);
  }

  @Get("overview.csv")
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", 'attachment; filename="report.csv"')
  csv(@Req() req: any, @Query("from") from?: string, @Query("to") to?: string) {
    return this.reports.overviewCsv(this.ctx(req), from, to);
  }

  @Get("dnc-audit")
  dncAudit(@Req() req: any) {
    return this.reports.dncAudit(this.ctx(req));
  }
}
