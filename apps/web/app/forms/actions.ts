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

export async function createForm(form: FormData) {
  const orgId = await ownerOrg();
  const lines = String(form.get("fields") ?? "").split(/\r?\n/);
  const fields = [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "phone", label: "WhatsApp number", type: "phone", required: true },
    ...lines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [key = "", label = "", type = "text", req = ""] = l.split("|").map((s) => s.trim());
        return { key, label: label || key, type, required: req === "required" };
      }),
  ];
  const res = await apiFetch("/forms", {
    method: "POST",
    orgId,
    body: {
      name: String(form.get("name") ?? ""),
      fields,
      source: String(form.get("source") ?? "") || "Website",
      pipelineId: String(form.get("pipelineId") ?? "") || undefined,
      assigneeId: String(form.get("assigneeId") ?? "") || undefined,
      sequenceId: String(form.get("sequenceId") ?? "") || undefined,
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/forms");
}

export async function toggleForm(id: string, active: boolean) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/forms/${id}`, { method: "PATCH", orgId, body: { active } });
  if (!res.ok) throw new Error("Update failed");
  revalidatePath("/forms");
}

export async function deleteForm(id: string) {
  const orgId = await ownerOrg();
  const res = await apiFetch(`/forms/${id}`, { method: "DELETE", orgId });
  if (!res.ok) throw new Error("Delete failed");
  revalidatePath("/forms");
}
