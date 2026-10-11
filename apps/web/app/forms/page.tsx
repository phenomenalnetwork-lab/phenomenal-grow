import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { createForm, toggleForm, deleteForm } from "./actions";

export default async function FormsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/");
  const isOwner = m.role === "OWNER";

  const res = await apiFetch("/forms", { orgId: m.orgId });
  const forms = res.ok ? ((res.data as any[]) ?? []) : [];
  const pipes = (((await apiFetch("/pipelines", { orgId: m.orgId })).data as any[]) ?? []);
  const seqs = (((await apiFetch("/sequences", { orgId: m.orgId })).data as any[]) ?? []);
  const host = (await headers()).get("host") ?? "localhost:3000";

  return (
    <Shell>
      <div className="card">
        <h2>Capture forms</h2>
        <p>Each form has a public link (QR-printable). Submissions create or match contacts and start their journey.</p>
        {forms.map((f: any) => (
          <div key={f.id} style={{ borderTop: "1px solid #e2e8f0", marginTop: 12, paddingTop: 8 }}>
            <p>
              <strong>{f.name}</strong> <small>({f.active ? "active" : "off"} · source: {f.source})</small>
            </p>
            <p>
              <code>
                http://{host}/f/{f.token}
              </code>
            </p>
            {isOwner && (
              <>
                <form action={toggleForm.bind(null, f.id, !f.active)} style={{ display: "inline", marginRight: 8 }}>
                  <button type="submit">{f.active ? "Disable" : "Enable"}</button>
                </form>
                <form action={deleteForm.bind(null, f.id)} style={{ display: "inline" }}>
                  <button type="submit">Delete</button>
                </form>
              </>
            )}
          </div>
        ))}
        {isOwner && (
          <>
            <h3>New form</h3>
            <form action={createForm}>
              <p>
                <input name="name" placeholder="e.g. Event Registration" required />
                <input name="source" placeholder="Source (default Website)" />
              </p>
              <p>
                <textarea
                  name="fields"
                  rows={3}
                  cols={70}
                  placeholder={"Extra fields, one per line: key|Label|type|required?\ngoal|Main goal|text|required\nnotes|Anything else|textarea"}
                />
              </p>
              <p>
                <select name="pipelineId" defaultValue="">
                  <option value="">No pipeline</option>
                  {pipes.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select name="sequenceId" defaultValue="">
                  <option value="">No sequence</option>
                  {seqs.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </p>
              <button type="submit">Create form</button>
            </form>
          </>
        )}
      </div>
    </Shell>
  );
}
