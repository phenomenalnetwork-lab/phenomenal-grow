import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { Shell } from "../shell";
import { createContact } from "./actions";

async function saveView(orgId: string, form: FormData) {
  "use server";
  const session = await getSession();
  if (!session) redirect("/login");
  const name = String(form.get("name") ?? "").trim();
  const filters = JSON.parse(String(form.get("filters") ?? "{}"));
  if (!name) throw new Error("View name required");
  await prisma.savedView.create({ data: { orgId, ownerId: session.user.id, name, filters } });
  revalidatePath("/contacts");
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const orgId = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!orgId) redirect("/");

  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ["q", "status", "assigned", "tag"] as const) {
    if (sp[k]) qs.set(k, sp[k] as string);
  }
  qs.set("take", "50");
  const res = await apiFetch(`/contacts?${qs.toString()}`, { orgId });
  const list = res.ok ? (res.data as any) : { items: [], total: 0 };
  const views = await prisma.savedView.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  const currentFilters = JSON.stringify({ q: sp.q ?? "", status: sp.status ?? "", tag: sp.tag ?? "" });

  return (
    <Shell>
      <div className="card">
        <h2>Contacts ({list.total})</h2>
        {views.length > 0 && (
          <p>
            Saved views:{" "}
            {views.map((v) => {
              const f = v.filters as Record<string, string>;
              const q = new URLSearchParams();
              if (f.q) q.set("q", f.q);
              if (f.status) q.set("status", f.status);
              if (f.tag) q.set("tag", f.tag);
              return (
                <a key={v.id} href={`/contacts?${q.toString()}`} style={{ marginRight: 8 }}>
                  {v.name}
                </a>
              );
            })}
          </p>
        )}
        <form method="get">
          <input name="q" placeholder="Search name, phone, email" defaultValue={sp.q ?? ""} />
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All statuses</option>
            {["ACTIVE", "INACTIVE", "ARCHIVED", "DNC"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input name="tag" placeholder="Tag" defaultValue={sp.tag ?? ""} />
          <button type="submit">Search</button>
        </form>
        <form action={saveView.bind(null, orgId)}>
          <input type="hidden" name="filters" value={currentFilters} />
          <input name="name" placeholder="Save current search as…" />
          <button type="submit">Save view</button>
        </form>
        {!res.ok && <p style={{ color: "var(--pg-overdue)" }}>List failed: {(res.data as any)?.message}</p>}
        <ul>
          {list.items.map((c: any) => (
            <li key={c.id}>
              <a href={`/contacts/${c.id}`}>
                {c.name} ({c.phoneE164})
              </a>{" "}
              · {c.status} · {(c.tags ?? []).map((t: any) => t.tag.name).join(", ")}
            </li>
          ))}
        </ul>
        <h3>New contact</h3>
        <form action={createContact}>
          <input name="name" placeholder="Name" required />
          <input name="phone" placeholder="+15551234567" required />
          <input name="email" placeholder="Email (optional)" />
          <input name="source" placeholder="Source (optional)" />
          <button type="submit">Create</button>
        </form>
        <p>
          <a href="/contacts/import">Import / Export</a>
        </p>
      </div>
    </Shell>
  );
}
