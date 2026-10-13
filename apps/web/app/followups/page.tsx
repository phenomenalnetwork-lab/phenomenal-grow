import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { Avatar } from "../avatar";
import { createFollowupByPhone, toggleFollowup } from "./actions";

const VIEWS = [
  ["overdue", "Overdue"],
  ["today", "Due Today"],
  ["mine", "Assigned to Me"],
  ["all", "All Open"],
] as const;

export default async function FollowupsPage({
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
  const view = (sp.view as string) || "today";
  const res = await apiFetch(`/followups?view=${encodeURIComponent(view)}`, { orgId });
  const list = res.ok ? (res.data as any) : { items: [], total: 0 };

  return (
    <Shell accent="followups">
      <div className="card card-accent">
        <h2>Follow-ups</h2>
        <p>
          <a href="/sequences">Sequences →</a>
        </p>
        <p>
          {VIEWS.map(([v, label]) => (
            <a key={v} href={`/followups?view=${v}`} style={{ marginRight: 10, fontWeight: view === v ? "bold" : "normal" }}>
              {label}
            </a>
          ))}
        </p>
        {!res.ok && <p style={{ color: "var(--pg-overdue)" }}>Load failed</p>}
        <ul className="clean">
          {list.items.map((f: any) => (
            <li key={f.id}>
              <Avatar name={f.contact?.name ?? "?"} size={24} />
              <a href={`/contacts/${f.contactId}`}>{f.contact?.name}</a> — {f.title}{" "}
              <small>(due {String(f.dueAt).slice(0, 16)})</small>{" "}
              <form action={toggleFollowup.bind(null, f.id, true, `/followups?view=${view}`)} style={{ display: "inline" }}>
                <button type="submit" className="inline">Done</button>
              </form>
            </li>
          ))}
        </ul>
        {list.items.length === 0 && <p>Nothing here. Enjoy the calm.</p>}
        <h3>New follow-up</h3>
        <form action={createFollowupByPhone}>
          <input name="phone" placeholder="Contact phone" required />
          <input name="title" placeholder="e.g. Call tomorrow at 10 AM" required />
          <input name="dueAt" type="datetime-local" required />
          <button type="submit">Create</button>
        </form>
      </div>
    </Shell>
  );
}
