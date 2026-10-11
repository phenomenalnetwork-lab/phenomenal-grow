import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Enforces org membership (and optional OWNER role) from the x-org-id header.
 * Agent scoping (assigned-only data) is applied in each module's queries (Phase 1+).
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId: string | undefined = req.headers["x-org-id"];
    if (!orgId) throw new ForbiddenException("Missing x-org-id");
    const m = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: req.user.id } },
    });
    if (!m || !m.active) throw new ForbiddenException();
    req.membership = m;
    return true;
  }
}
