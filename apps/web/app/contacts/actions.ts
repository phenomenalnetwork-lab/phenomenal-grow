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

export async function createContact(form: FormData) {
  const id = await orgId();
  const res = await apiFetch("/contacts", {
    method: "POST",
    orgId: id,
    body: {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      email: String(form.get("email") ?? "") || undefined,
      source: String(form.get("source") ?? "") || undefined,
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/contacts");
  redirect(`/contacts/${(res.data as any).id}`);
}

export async function updateContact(id: string, form: FormData) {
  const oid = await orgId();
  const body: Record<string, unknown> = {};
  for (const f of ["name", "phone", "email", "source", "referredBy", "status", "assignedAgentId", "nextActionAt"] as const) {
    const v = form.get(f);
    if (v !== null) body[f] = String(v) || null;
  }
  const cf = form.get("customFields");
  if (cf !== null && String(cf).trim()) {
    try {
      body.customFields = JSON.parse(String(cf));
    } catch {
      throw new Error("Custom fields must be valid JSON");
    }
  }
  const res = await apiFetch(`/contacts/${id}`, { method: "PATCH", orgId: oid, body });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update failed");
  revalidatePath(`/contacts/${id}`);
}

export async function addNote(id: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/contacts/${id}/notes`, {
    method: "POST",
    orgId: oid,
    body: { body: String(form.get("body") ?? "") },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Note failed");
  revalidatePath(`/contacts/${id}`);
}

export async function addTag(id: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/contacts/${id}/tags`, {
    method: "POST",
    orgId: oid,
    body: { name: String(form.get("name") ?? "") },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Tag failed");
  revalidatePath(`/contacts/${id}`);
}

export async function removeTag(id: string, tagId: string) {
  const oid = await orgId();
  const res = await apiFetch(`/contacts/${id}/tags/${tagId}`, { method: "DELETE", orgId: oid });
  if (!res.ok) throw new Error("Remove tag failed");
  revalidatePath(`/contacts/${id}`);
}

export async function mergeContacts(survivingId: string, form: FormData) {
  const oid = await orgId();
  const otherPhone = String(form.get("otherPhone") ?? "").trim();
  if (!otherPhone) throw new Error("Other contact phone required");
  const found = await apiFetch(`/contacts?q=${encodeURIComponent(otherPhone)}&take=5`, { orgId: oid });
  if (!found.ok) throw new Error("Lookup failed");
  const other = (found.data as any).items?.[0];
  if (!other) throw new Error("No contact found with that phone");
  if (other.id === survivingId) throw new Error("Cannot merge a contact into itself");
  const res = await apiFetch("/contacts/merge", {
    method: "POST",
    orgId: oid,
    body: { survivingId, mergedId: other.id },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Merge failed");
  revalidatePath("/contacts");
  redirect(`/contacts/${survivingId}`);
}
