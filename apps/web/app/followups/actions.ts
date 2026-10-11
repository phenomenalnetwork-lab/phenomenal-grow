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

export async function createFollowup(contactId: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/followups/contact/${contactId}`, {
    method: "POST",
    orgId: oid,
    body: {
      title: String(form.get("title") ?? ""),
      dueAt: String(form.get("dueAt") ?? ""),
      assignedAgentId: String(form.get("assignedAgentId") ?? "") || undefined,
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/followups");
  revalidatePath(`/contacts/${contactId}`);
}

export async function createFollowupByPhone(form: FormData) {
  const oid = await orgId();
  const phone = String(form.get("phone") ?? "").trim();
  const found = await apiFetch(`/contacts?q=${encodeURIComponent(phone)}&take=5`, { orgId: oid });
  if (!found.ok) throw new Error("Lookup failed");
  const contact = (found.data as any).items?.[0];
  if (!contact) throw new Error("No contact found with that phone");
  return createFollowup(contact.id, form);
}

export async function toggleFollowup(id: string, done: boolean, backTo: string) {
  const oid = await orgId();
  const res = await apiFetch(`/followups/${id}`, { method: "PATCH", orgId: oid, body: { done } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update failed");
  revalidatePath(backTo);
}
