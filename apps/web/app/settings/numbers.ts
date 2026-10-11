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
  if (!m || m.role !== "OWNER") throw new Error("Owners only");
  return m.orgId;
}

export async function registerNumber(form: FormData) {
  const orgId = await ownerOrg();
  const res = await apiFetch("/whatsapp/numbers", {
    method: "POST",
    orgId,
    body: {
      label: String(form.get("label") ?? ""),
      providerNumberId: String(form.get("providerNumberId") ?? ""),
      accessToken: String(form.get("accessToken") ?? ""),
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Register failed");
  revalidatePath("/settings");
}

export async function removeNumber(id: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/whatsapp/numbers/${id}`, { method: "DELETE", orgId });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Remove failed (open conversations?)");
  revalidatePath("/settings");
}
