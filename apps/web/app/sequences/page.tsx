import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { templateSequence, createSequence, deleteSequence, enrollmentAction, runReengagement } from "./actions";

const TEMPLATES = ["new-lead", "visitor", "appointment", "unresponsive", "customer", "event"] as const;

export default async function SequencesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/");
  const isOwner = m.role === "OWNER";

  const res = await apiFetch("/sequences", { orgId: m.orgId });
  const seqs = res.ok ? ((res.data as any[]) ?? []) : [];
  const enrollments = await Promise.all(
    seqs.map(async (s: any) => ({
      seq: s,
      items: (((await apiFetch(`/sequences/${s.id}/enrollments`, { orgId: m.orgId })).data as any[]) ?? []).slice(0, 20),
    })),
  );

  return (
    <Shell>
      <div className="card">
        <h2>Follow-up sequences</h2>
        <p>
          Steps support {"{{name}}"} — replaced with the contact's first name. Replies pause a sequence; conversion,
          DNC and manual stops end it. Every pause/stop lands in the contact timeline.
        </p>
        {isOwner && (
          <>
            <div>
              Guided templates:{" "}
              {TEMPLATES.map((t) => (
                <form key={t} action={templateSequence.bind(null, t)} style={{ display: "inline", marginRight: 8 }}>
                  <button type="submit">{t}</button>
                </form>
              ))}
            </div>
            <h3>Custom sequence</h3>
            <form action={createSequence}>
              <input name="name" placeholder="Sequence name" required />
              <label>
                <input type="checkbox" name="postConversion" /> runs after conversion
              </label>
              <br />
              <textarea name="steps" rows={4} cols={70} placeholder={"One step per line: days|message\n0|Hi {{name}}, thanks for reaching out!\n2|Hi {{name}}, checking in…"} required />
              <br />
              <button type="submit">Create</button>
            </form>
          </>
        )}
        {seqs.map((s: any) => (
          <div key={s.id} style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 12 }}>
            <h3>
              {s.name} <small>({s.kind}{s.postConversion ? ", post-conversion" : ""})</small>
            </h3>
            <ol>
              {(s.steps ?? []).map((st: any) => (
                <li key={st.id}>
                  Day {st.dayOffset}: {st.body}
                </li>
              ))}
            </ol>
            {isOwner && (
              <form action={deleteSequence.bind(null, s.id)}>
                <button type="submit">Delete</button>
              </form>
            )}
            <h4>Enrollments</h4>
            <ul>
              {(enrollments.find((e) => e.seq.id === s.id)?.items ?? []).map((e: any) => (
                <li key={e.id}>
                  <a href={`/contacts/${e.contact?.id}`}>{e.contact?.name}</a> · {e.status} · step {e.currentStep}
                  {e.status === "ACTIVE" && (
                    <form action={enrollmentAction.bind(null, e.id, "pause")} style={{ display: "inline", marginLeft: 8 }}>
                      <button type="submit">Pause</button>
                    </form>
                  )}
                  {e.status === "PAUSED" && (
                    <form action={enrollmentAction.bind(null, e.id, "resume")} style={{ display: "inline", marginLeft: 8 }}>
                      <button type="submit">Resume</button>
                    </form>
                  )}
                  {(e.status === "ACTIVE" || e.status === "PAUSED") && (
                    <form action={enrollmentAction.bind(null, e.id, "stop")} style={{ display: "inline", marginLeft: 8 }}>
                      <button type="submit">Stop</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h3>Re-engagement</h3>
        <p>Quiet contacts (no open follow-up) get a manual “Re-engage” follow-up for their agent.</p>
        <form action={runReengagement}>
          <input name="inactiveDays" defaultValue={30} size={4} /> days quiet
          <button type="submit">Run scan now</button>
        </form>
      </div>
    </Shell>
  );
}
