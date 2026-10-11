import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const orgId = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!orgId) redirect("/");
  const res = await apiFetch<string>("/contacts/export", { orgId });
  if (!res.ok) redirect("/contacts/import");
  return new Response(res.data as unknown as string, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="contacts.csv"',
    },
  });
}
