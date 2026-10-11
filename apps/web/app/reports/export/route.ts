import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m || m.role !== "OWNER") redirect("/reports");
  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams();
  if (searchParams.get("from")) qs.set("from", searchParams.get("from")!);
  if (searchParams.get("to")) qs.set("to", searchParams.get("to")!);
  const res = await apiFetch<string>(`/reports/overview.csv?${qs.toString()}`, { orgId: m.orgId });
  if (!res.ok) redirect("/reports");
  return new Response(res.data as unknown as string, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="report.csv"' },
  });
}
