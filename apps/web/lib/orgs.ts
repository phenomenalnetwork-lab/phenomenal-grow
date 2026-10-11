import { headers, cookies } from "next/headers";
import { auth } from "./auth";
import { prisma } from "./prisma";

export const ACTIVE_ORG_COOKIE = "pgrow-org";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) throw new Response("Unauthorized", { status: 401 });
  return session.user;
}

/** All orgs the current user actively belongs to, with their role. */
export async function myMemberships(userId: string) {
  return prisma.membership.findMany({
    where: { userId, active: true },
    include: { org: true },
    orderBy: { org: { name: "asc" } },
  });
}

export async function requireMembership(userId: string, orgId: string, ownerOnly = false) {
  const m = await prisma.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!m || !m.active) throw new Response("Forbidden", { status: 403 });
  if (ownerOnly && m.role !== "OWNER") throw new Response("Forbidden", { status: 403 });
  return m;
}

export async function getActiveOrgId(): Promise<string | null> {
  return (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || `org-${Date.now()}`
  );
}
