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

export async function createAppointment(contactId: string, form: FormData) {
  const oid = await orgId();
  const res = await apiFetch(`/appointments/contact/${contactId}`, {
    method: "POST",
    orgId: oid,
    body: {
      date: String(form.get("date") ?? ""),
      time: String(form.get("time") ?? "") || undefined,
      type: String(form.get("type") ?? "") || undefined,
      assigneeId: String(form.get("assigneeId") ?? "") || undefined,
      notes: String(form.get("notes") ?? "") || undefined,
      pipelineId: String(form.get("pipelineId") ?? "") || undefined,
      stageId: String(form.get("stageId") ?? "") || undefined,
    },
  });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Create failed");
  revalidatePath("/appointments");
  revalidatePath(`/contacts/${contactId}`);
}

export async function createAppointmentByPhone(form: FormData) {
  const oid = await orgId();
  const phone = String(form.get("phone") ?? "").trim();
  const found = await apiFetch(`/contacts?q=${encodeURIComponent(phone)}&take=5`, { orgId: oid });
  if (!found.ok) throw new Error("Lookup failed");
  const contact = (found.data as any).items?.[0];
  if (!contact) throw new Error("No contact found with that phone");
  return createAppointment(contact.id, form);
}

export async function updateAppointment(id: string, status: string, backTo: string) {
  const oid = await orgId();
  const res = await apiFetch(`/appointments/${id}`, { method: "PATCH", orgId: oid, body: { status } });
  if (!res.ok) throw new Error((res.data as any)?.message ?? "Update failed");
  revalidatePath(backTo);
}
