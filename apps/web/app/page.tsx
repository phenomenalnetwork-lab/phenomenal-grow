import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "./shell";

function Section({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 12 }}>
      <h3>
        {title} {link && <a href={link}>→</a>}
      </h3>
      {children}
    </div>
  );
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/settings");
  const isOwner = m.role === "OWNER";

  const res = await apiFetch<any>("/home", { orgId: m.orgId });
  if (!res.ok) redirect("/settings");
  const d = res.data;
  const s = d.snapshot;

  return (
    <Shell>
      <div className="card">
        <span className="badge">{isOwner ? `${m.org.name} · Owner` : `${m.org.name} · My Day`}</span>
        <h2>Who needs me right now?</h2>

        <Section title={`Needs Reply (${d.needsReply.length})`} link="/inbox?view=needs-reply">
          <ul>
            {d.needsReply.map((c: any) => (
              <li key={c.id}>
                <a href={`/inbox/${c.id}`}>
                  {c.contact?.name} ({c.contact?.phoneE164})
                </a>{" "}
                <small>· {c.number?.label}</small>
              </li>
            ))}
            {d.needsReply.length === 0 && <li>All caught up.</li>}
          </ul>
        </Section>

        <Section title={`Overdue (${d.overdue.length})`} link="/followups?view=overdue">
          <ul>
            {d.overdue.map((f: any) => (
              <li key={f.id}>
                <a href={`/contacts/${f.contactId}`}>{f.contact?.name}</a> — {f.title}{" "}
                <small>(due {String(f.dueAt).slice(0, 16)})</small>
              </li>
            ))}
            {d.overdue.length === 0 && <li>Nothing overdue.</li>}
          </ul>
        </Section>

        <Section title={`Due Today (${d.dueToday.length})`} link="/followups?view=today">
          <ul>
            {d.dueToday.map((f: any) => (
              <li key={f.id}>
                <a href={`/contacts/${f.contactId}`}>{f.contact?.name}</a> — {f.title}
              </li>
            ))}
            {d.dueToday.length === 0 && <li>Nothing due today.</li>}
          </ul>
        </Section>

        <Section title={`New Contacts (${d.newContacts.length})`} link="/contacts">
          <ul>
            {d.newContacts.map((c: any) => (
              <li key={c.id}>
                <a href={`/contacts/${c.id}`}>{c.name}</a> <small>· next: {c.suggested}</small>
              </li>
            ))}
            {d.newContacts.length === 0 && <li>No new contacts this week.</li>}
          </ul>
        </Section>

        <Section title={`Active Opportunities (${d.opportunities.length})`} link="/pipelines">
          <ul>
            {d.opportunities.map((o: any) => (
              <li key={o.id}>
                <a href={`/contacts/${o.contactId}`}>{o.contact?.name}</a> <small>· {o.pipeline?.name} / {o.stage?.name} · next: {o.suggested}</small>
              </li>
            ))}
            {d.opportunities.length === 0 && <li>No active opportunities.</li>}
          </ul>
        </Section>

        <Section title="Today's progress">
          <p>
            {d.completedToday.followups.length} follow-up(s) completed · {d.completedToday.replies} replie(s) sent
          </p>
          <ul>
            {d.completedToday.followups.map((f: any) => (
              <li key={f.id}>
                ✓ {f.title} (<a href={`/contacts/${f.contactId}`}>{f.contact?.name}</a>)
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Snapshot">
          <p>
            Contacts: {(s.contactsByStatus as any[]).map((g) => `${g.status} ${g._count}`).join(" · ")}
          </p>
          <p>
            Conversations open: {s.conversationsOpen} ({s.needsReplyCount} need reply) · Follow-ups open:{" "}
            {s.followupsOpen} ({s.followupsOverdue} overdue, {s.followupsDueToday} due today) · Active sequences:{" "}
            {s.enrollmentsActive}
          </p>
          <p>
            Outcomes: {(s.outcomes as any[]).map((g) => `${g.outcome} ${g._count}`).join(" · ")} · Converted total:{" "}
            {s.convertedTotal}
          </p>
          <p>Top sources: {(s.topSources as any[]).map((g) => `${g.source ?? "—"} ${g._count}`).join(" · ") || "—"}</p>
        </Section>

        {isOwner && d.team && (
          <Section title="Team">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Assigned</th>
                  <th>Open FU</th>
                  <th>Overdue</th>
                  <th>Conversions</th>
                  <th>Replies 7d</th>
                </tr>
              </thead>
              <tbody>
                {(d.team as any[]).map((t: any) => (
                  <tr key={t.user.id}>
                    <td>
                      {t.user.name} ({t.role})
                    </td>
                    <td>{t.assigned}</td>
                    <td>{t.openFollowups}</td>
                    <td>{t.overdue}</td>
                    <td>{t.conversions}</td>
                    <td>{t.replies7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>
    </Shell>
  );
}
