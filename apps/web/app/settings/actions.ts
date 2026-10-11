"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";

async function ownerOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m || m.role !== "OWNER") throw new Error("Owners only");
  return m.orgId;
}

export async function deactivateMember(userId: string, form: FormData) {
  const orgId = await ownerOrg();
  const jar = await cookies();
  const cookie = jar.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
  const mode = String(form.get("mode") ?? "all");
  const reassignTo = String(form.get("reassignTo") ?? "") || null;
  const res = await fetch(
    `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/orgs/${orgId}/members/${userId}/deactivate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ mode, reassignTo }),
    },
  );
  if (!res.ok) throw new Error("Deactivation failed");
  revalidatePath("/settings");
}
