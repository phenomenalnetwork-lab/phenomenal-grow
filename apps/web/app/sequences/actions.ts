"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

async function ownerOrg(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) throw new Error("No organisation");
  return m.orgId;
}

export async function templateSequence(template: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch("/sequences/from-template", { method: "POST", orgId, body: { template } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Template failed");
  revalidatePath("/sequences");
}

export async function createSequence(form: FormData) {
  const orgId = await ownerOrg();
  const lines = String(form.get("steps") ?? "").split(/\r?\n/);
  const steps = lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      if (i < 0) throw new Error(`Bad step line (use days|message): ${l}`);
      return { dayOffset: Number(l.slice(0, i).trim()), body: l.slice(i + 1).trim() };
    });
  const res = await apiFetch("/sequences", {
    method: "POST",
    orgId,
    body: { name: String(form.get("name") ?? ""), postConversion: form.get("postConversion") === "on", steps },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/sequences");
}

export async function deleteSequence(id: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/sequences/${id}`, { method: "DELETE", orgId });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Delete failed (active enrollments?)");
  revalidatePath("/sequences");
}

export async function enrollmentAction(id: string, action: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/enrollments/${id}`, { method: "PATCH", orgId, body: { action } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Action failed");
  revalidatePath("/sequences");
}

export async function runReengagement(form: FormData) {
  const orgId = await ownerOrg();
  const res = await apiFetch("/reengagement/scan", {
    method: "POST",
    orgId,
    body: { inactiveDays: Number(form.get("inactiveDays") ?? 30) },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Scan failed");
  revalidatePath("/sequences");
  revalidatePath("/followups");
}
