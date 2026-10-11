import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { createPipeline, templatePipeline, renamePipeline, deletePipeline, addStage, updateStage, deleteStage } from "./actions";

export default async function PipelinesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/");
  const isOwner = m.role === "OWNER";

  const res = await apiFetch("/pipelines", { orgId: m.orgId });
  const pipes = res.ok ? ((res.data as any[]) ?? []) : [];

  return (
    <Shell>
      <div className="card">
        <h2>Pipelines</h2>
        {!res.ok && <p style={{ color: "var(--pg-overdue)" }}>Load failed</p>}
        {isOwner && (
          <>
            <form action={createPipeline}>
              <input name="name" placeholder="New pipeline name" required />
              <button type="submit">Create</button>
            </form>
            <div>
              Start from a template:{" "}
              {(["business", "church", "coach"] as const).map((t) => (
                <form key={t} action={templatePipeline.bind(null, t)} style={{ display: "inline", marginRight: 8 }}>
                  <button type="submit">{t}</button>
                </form>
              ))}
            </div>
          </>
        )}
        {pipes.map((p: any) => (
          <div key={p.id} style={{ borderTop: "1px solid #e2e8f0", marginTop: 16, paddingTop: 12 }}>
            <h3>
              {p.name} <small>({p.type}) · {p.activeCount} active</small>
            </h3>
            <p>{(p.stages ?? []).map((s: any) => `${s.name}${s.isConversion ? " ✓" : ""}`).join(" → ") || "No stages"}</p>
            {isOwner && (
              <>
                <form action={renamePipeline.bind(null, p.id)}>
                  <input name="name" defaultValue={p.name} required />
                  <button type="submit">Rename</button>
                </form>
                <form action={deletePipeline.bind(null, p.id)}>
                  <button type="submit">Delete pipeline</button>
                </form>
                <h4>Stages</h4>
                {(p.stages ?? []).map((s: any) => (
                  <form key={s.id} action={updateStage.bind(null, p.id, s.id)}>
                    <input name="name" defaultValue={s.name} required size={18} />
                    <input name="expectedAction" defaultValue={s.expectedAction ?? ""} placeholder="Expected action" size={16} />
                    <input name="order" defaultValue={s.order} size={3} />
                    <label>
                      <input type="checkbox" name="isConversion" defaultChecked={s.isConversion} /> conversion
                    </label>
                    <button type="submit">Save</button>
                    <button type="submit" formAction={deleteStage.bind(null, p.id, s.id)}>
                      Delete
                    </button>
                  </form>
                ))}
                <form action={addStage.bind(null, p.id)}>
                  <input name="name" placeholder="New stage" required />
                  <input name="expectedAction" placeholder="Expected action" />
                  <label>
                    <input type="checkbox" name="isConversion" /> conversion
                  </label>
                  <button type="submit">Add stage</button>
                </form>
                <p>
                  <small>To delete an occupied stage, first move its contacts (API: DELETE stage with ?moveTo=stageId).</small>
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}
