import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Verifies the Better Auth session by forwarding the request cookies to the
 * web app's get-session endpoint. The API never mints or reads sessions itself.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    const cookie = req.headers.cookie ?? "";
    if (!cookie) throw new UnauthorizedException();

    const res = await fetch(`${base}/api/auth/get-session`, { headers: { cookie } });
    if (!res.ok) throw new UnauthorizedException();
    const session = (await res.json()) as { user?: SessionUser } | null;
    if (!session?.user) throw new UnauthorizedException();
    req.user = session.user;
    return true;
  }
}
