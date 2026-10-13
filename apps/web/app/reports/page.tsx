import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { Avatar } from "../avatar";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/");
  if (m.role !== "OWNER") {
    return (
      <Shell accent="reports">
        <div className="card card-accent">
          <h2>Reports</h2>
          <p>Reports are available to organisation owners. Your action dashboard is on the Home page.</p>
        </div>
      </Shell>
    );
  }
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const res = await apiFetch<any>(`/reports/overview?${qs.toString()}`, { orgId: m.orgId });
  if (!res.ok) {
    return (
      <Shell accent="reports">
        <div className="card">
          <h2>Reports</h2>
          <p style={{ color: "var(--pg-overdue)" }}>Load failed</p>
        </div>
      </Shell>
    );
  }
  const o = res.data;
  const dnc = await apiFetch<any>("/reports/dnc-audit", { orgId: m.orgId });
  const audit = dnc.ok ? dnc.data : null;
  return (
    <Shell accent="reports">
      <div className="card">
        <h2>Reports</h2>
        <form method="get">
          <input name="from" type="date" defaultValue={sp.from ?? ""} />
          <input name="to" type="date" defaultValue={sp.to ?? ""} />
          <button type="submit">Apply range</button> <a href={`/reports/export?${qs.toString()}`}>Download CSV</a>
        </form>

        <h3>Contacts ({o.contacts.new} new in range)</h3>
        <p>{o.contacts.byStatus.map((g: any) => `${g.status}: ${g._count}`).join(" · ")}</p>

        <h3>Pipelines</h3>
        {o.pipelines.map((p: any) => (
          <div key={p.pipeline}>
            <p>
              <strong>{p.pipeline}</strong> — entered {p.entered}, converted {p.converted}, not converted {p.notConverted}, ongoing {p.ongoing}
            </p>
            <p>
              <small>{p.byStage.map((s: any) => `${s.stage}: ${s.count}`).join(" · ") || "no ongoing"}</small>
            </p>
          </div>
        ))}

        <h3>Follow-ups</h3>
        <p>
          Completed {o.followups.completed} · Overdue {o.followups.overdue} · Due today {o.followups.dueToday} · Outstanding{" "}
          {o.followups.outstanding}
        </p>

        <h3>Conversions ({o.conversions.rate}% rate)</h3>        <p>{o.conversions.byOutcome.map((g: any) => `${g.outcome}: ${g._count}`).join(" · ")}</p>
        {(() => {
          const max = Math.max(1, ...o.conversions.byOutcome.map((g: any) => g._count));
          return o.conversions.byOutcome.map((g: any) => (
            <div className="bar-row" key={g.outcome}>
              <span className="bar-label">{g.outcome}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.round((g._count / max) * 100)}%` }} />
              </span>
              <span className="bar-value">{g._count}</span>
            </div>
          ));
        })()}
        <p>
          <small>Not-converted reasons: {o.conversions.reasons.map((g: any) => `${g.outcomeReason ?? "—"}: ${g._count}`).join(" · ") || "—"}</small>
        </p>

        <h3>Source funnel</h3>
        {o.funnel.map((f: any) => {
          const max = Math.max(1, ...o.funnel.map((x: any) => x.contacts));
          return (
            <div key={f.source}>
              <div className="bar-row">
                <span className="bar-label">{f.source}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.round((f.contacts / max) * 100)}%` }} />
                </span>
                <span className="bar-value">{f.contacts}</span>
              </div>
              <p>
                <small>
                  {f.conversations} conversations → {f.converted} converted
                </small>
              </p>
            </div>
          );
        })}

        <h3>Agents</h3>        <table className="grid">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Handled</th>
              <th>FU done</th>
              <th>Outstanding</th>
              <th>Conversions</th>
              <th>Replies</th>
            </tr>
          </thead>
          <tbody>
            {o.agents.map((a: any) => (
              <tr key={a.user.id}>
                <td>
                  <Avatar name={a.user.name} size={22} />
                  {a.user.name}
                </td>
                <td>{a.handled}</td>
                <td>{a.followupsCompleted}</td>
                <td>{a.outstanding}</td>
                <td>{a.conversions}</td>
                <td>{a.replies}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>DNC compliance audit</h3>
        {audit ? (
          <p>
            DNC contacts: {audit.dncContacts} · Active automations on DNC: {audit.activeEnrollmentsOnDnc} · Outbound
            messages to DNC: {audit.outboundMessagesToDnc} ·{" "}
            <strong>{audit.compliant ? "COMPLIANT" : "ACTION REQUIRED"}</strong>
          </p>
        ) : (
          <p>Audit unavailable.</p>
        )}
      </div>
    </Shell>
  );
}
