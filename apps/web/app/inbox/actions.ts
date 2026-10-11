"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";

async function orgId(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  const active = await getActiveOrgId();
  const ms = await myMemberships(session.user.id);
  const id = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!id) throw new Error("No organisation");
  return id;
}

export async function replyToConversation(id: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/conversations/${id}/reply`, {
    method: "POST",
    orgId: oid,
    body: { text: String(form.get("text") ?? "") },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Reply failed");
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}

export async function updateConversation(id: string, form: FormData) {  const oid = await orgId();
  const body: Record<string, unknown> = {};
  const status = form.get("status");
  const assignee = form.get("assignedAgentId");
  if (status !== null) body.status = String(status);
  if (assignee !== null) body.assignedAgentId = String(assignee) || null;
  const res = await apiFetch(`/conversations/${id}`, { method: "PATCH", orgId: oid, body });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update failed");
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}

export async function moveStageFromInbox(conversationId: string, contactId: string, pipelineId: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/contacts/${contactId}/pipelines/${pipelineId}`, {
    method: "PATCH",
    orgId: oid,
    body: { stageId: String(form.get("stageId") ?? "") },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Move failed");
  revalidatePath(`/inbox/${conversationId}`);
}
