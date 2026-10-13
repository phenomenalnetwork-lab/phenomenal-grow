import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";

const VIEWS = [
  ["needs-reply", "Needs Reply"],
  ["unassigned", "Unassigned"],
  ["mine", "Assigned to Me"],
  ["recent", "Recently Active"],
  ["closed", "Closed"],
] as const;

export default async function InboxPage({
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
  const view = (sp.view as string) || "needs-reply";
  const res = await apiFetch(`/conversations?view=${encodeURIComponent(view)}&take=50`, { orgId });
  const list = res.ok ? (res.data as any) : { items: [], total: 0 };

  return (
    <Shell>
      <div className="card">
        <h2>Inbox</h2>
        <p>
          {VIEWS.map(([v, label]) => (
            <a key={v} href={`/inbox?view=${v}`} style={{ marginRight: 10, fontWeight: view === v ? "bold" : "normal" }}>
              {label}
            </a>
          ))}
        </p>
        {!res.ok && <p style={{ color: "var(--pg-overdue)" }}>Load failed: {(res.data as any)?.message}</p>}
        <p>{list.total} conversation(s)</p>
        <ul className="clean">
          {list.items.map((c: any) => (
            <li key={c.id} className={c.needsReply ? "hot" : undefined}>
              <a href={`/inbox/${c.id}`}>
                <strong>{c.contact?.name ?? "Unknown"}</strong> ({c.contact?.phoneE164})
              </a>{" "}
              <small>
                · {c.number?.label} · {c.status}
              </small>
            </li>
          ))}
          {list.items.length === 0 && <li className="empty">No conversations here.</li>}
        </ul>
      </div>
    </Shell>
  );
}
