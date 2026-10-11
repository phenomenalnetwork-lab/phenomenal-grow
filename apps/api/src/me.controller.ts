import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { OrgGuard } from "./org.guard";
import { PrismaService } from "./prisma.service";

@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async me(@Req() req: any) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: req.user.id, active: true },
      include: { org: true },
    });
    return { user: req.user, memberships };
  }

  @Get("scoped-check")
  @UseGuards(OrgGuard)
  scoped(@Req() req: any) {
    return { ok: true, orgId: req.membership.orgId, role: req.membership.role };
  }
}
