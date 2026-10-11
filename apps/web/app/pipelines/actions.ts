"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

async function ownerOrg(): Promise<{ orgId: string; role: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) throw new Error("No organisation");
  return { orgId: m.orgId, role: m.role };
}

export async function createPipeline(form: FormData) {
  const { orgId } = await ownerOrg();
  const res = await apiFetch("/pipelines", {
    method: "POST",
    orgId,
    body: { name: String(form.get("name") ?? ""), type: "custom" },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/pipelines");
}

export async function templatePipeline(template: string) {
  const { orgId } = await ownerOrg();
  const res = await apiFetch("/pipelines/from-template", { method: "POST", orgId, body: { template } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Template failed");
  revalidatePath("/pipelines");
}

export async function renamePipeline(id: string, form: FormData) {
  const { orgId } = await ownerOrg();
  const res = await apiFetch(`/pipelines/${id}`, { method: "PATCH", orgId, body: { name: String(form.get("name") ?? "") } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Rename failed");
  revalidatePath("/pipelines");
}

export async function deletePipeline(id: string) {
  const { orgId } = await ownerOrg();
  const res = await apiFetch(`/pipelines/${id}`, { method: "DELETE", orgId });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Delete failed (contacts still enrolled?)");
  revalidatePath("/pipelines");
}

export async function addStage(pipelineId: string, form: FormData) {
  const { orgId } = await ownerOrg();
  const res = await apiFetch(`/pipelines/${pipelineId}/stages`, {
    method: "POST",
    orgId,
    body: {
      name: String(form.get("name") ?? ""),
      expectedAction: String(form.get("expectedAction") ?? "") || undefined,
      isConversion: form.get("isConversion") === "on",
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Add stage failed");
  revalidatePath("/pipelines");
}

export async function updateStage(pipelineId: string, stageId: string, form: FormData) {
  const { orgId } = await ownerOrg();
  const orderRaw = String(form.get("order") ?? "").trim();
  const res = await apiFetch(`/pipelines/${pipelineId}/stages/${stageId}`, {
    method: "PATCH",
    orgId,
    body: {
      name: String(form.get("name") ?? ""),
      expectedAction: String(form.get("expectedAction") ?? ""),
      order: orderRaw === "" ? undefined : Number(orderRaw),
      isConversion: form.get("isConversion") === "on",
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update stage failed");
  revalidatePath("/pipelines");
}

export async function deleteStage(pipelineId: string, stageId: string, form: FormData) {
  const { orgId } = await ownerOrg();
  const moveTo = String(form.get("moveTo") ?? "").trim();
  const res = await apiFetch(
    `/pipelines/${pipelineId}/stages/${stageId}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ""}`,
    { method: "DELETE", orgId },
  );
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Delete stage failed");
  revalidatePath("/pipelines");
}
