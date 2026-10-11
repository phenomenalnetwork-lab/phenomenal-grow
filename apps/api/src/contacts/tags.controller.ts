import { BadRequestException, Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth.guard";
import { OrgGuard } from "../org.guard";
import { PrismaService } from "../prisma.service";

@Controller("tags")
@UseGuards(AuthGuard, OrgGuard)
export class TagsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: any) {
    return this.prisma.tag.findMany({
      where: { orgId: req.membership.orgId },
      orderBy: { name: "asc" },
    });
  }

  @Post()
  async create(@Req() req: any, @Body() dto: any) {
    const name = String(dto?.name ?? "").trim();
    if (!name) throw new BadRequestException("Tag name required");
    return this.prisma.tag.upsert({
      where: { orgId_name: { orgId: req.membership.orgId, name } },
      update: {},
      create: { orgId: req.membership.orgId, name },
    });
  }
}
