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
      businessAccountId: String(form.get("businessAccountId") ?? ""),
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Register failed");
  revalidatePath("/settings");
}

export async function updateNumber(id: string, form: FormData) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/whatsapp/numbers/${id}`, {
    method: "PATCH",
    orgId,
    body: {
      label: String(form.get("label") ?? ""),
      providerNumberId: String(form.get("providerNumberId") ?? ""),
      // Empty = keep existing token (label-only edits stay easy).
      accessToken: String(form.get("accessToken") ?? ""),
      businessAccountId: String(form.get("businessAccountId") ?? ""),
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update failed");
  revalidatePath("/settings");
}

export async function testNumber(id: string): Promise<{ ok: boolean; detail: string }> {
  const orgId = await ownerOrg();
  const res = await apiFetch<{ ok: boolean; reason?: string; displayPhone?: string | null; dryRun?: boolean }>(
    `/whatsapp/numbers/${id}/test`,
    { method: "POST", orgId },
  );
  revalidatePath("/settings");
  if (!res.ok) return { ok: false, detail: (res.data as any)?.message ?? "Test failed — check the number settings and retry" };
  if ((res.data as any)?.ok) {
    const d = res.data as any;
    return {
      ok: true,
      detail: d.dryRun ? "Saved (dry-run mode — live check skipped)" : `Connected${d.displayPhone ? ` (${d.displayPhone})` : ""}`,
    };
  }
  return { ok: false, detail: (res.data as any)?.reason ?? "Meta rejected the credentials — check the token and Phone Number ID, then retry" };
}

export async function saveWebhookConfig(form: FormData) {
  const orgId = await ownerOrg();
  // Blank = keep the stored secret (rotation only replaces on input).
  const res = await apiFetch("/whatsapp/config", {
    method: "PUT",
    orgId,
    body: {
      verifyToken: String(form.get("verifyToken") ?? ""),
      appSecret: String(form.get("appSecret") ?? ""),
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Save failed");
  revalidatePath("/settings");
}

export async function removeNumber(id: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/whatsapp/numbers/${id}`, { method: "DELETE", orgId });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Disconnect blocked — see message for next steps");
  revalidatePath("/settings");
}
