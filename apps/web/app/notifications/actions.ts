"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

async function scope(): Promise<{ orgId: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) throw new Error("No organisation");
  return { orgId: m.orgId };
}

export async function markRead(id: string) {
  const { orgId } = await scope();
  await apiFetch(`/notifications/${id}/read`, { method: "PATCH", orgId });
  revalidatePath("/notifications");
}

export async function markAllRead() {
  const { orgId } = await scope();
  await apiFetch("/notifications/read-all", { method: "POST", orgId });
  revalidatePath("/notifications");
}

export async function setPreference(kind: string, form: FormData) {
  const { orgId } = await scope();
  await apiFetch("/notifications/preferences", {
    method: "POST",
    orgId,
    body: { kind, enabled: form.get("enabled") === "on" },
  });
  revalidatePath("/notifications");
}
