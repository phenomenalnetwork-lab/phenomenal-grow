import { redirect, notFound } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId, requireMembership } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { Shell } from "../../shell";
import { updateContact, addNote, addTag, removeTag, mergeContacts, enrollPipeline, movePipeline, outcomePipeline, unenrollPipeline, enrollSequence } from "../actions";
import { createFollowup, toggleFollowup } from "../../followups/actions";
import { NOT_CONVERTED_REASONS } from "@pgrow/types";

export default async function ContactDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const orgId = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!orgId) redirect("/");
  const myRole = ms.find((m) => m.orgId === orgId)?.role;

  const { id } = await params;
  const res = await apiFetch(`/contacts/${id}`, { orgId });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) notFound();
    throw new Error((res.data as any)?.message ?? "Load failed");
  }
  const c = res.data as any;
  const acts = await apiFetch(`/contacts/${id}/activities`, { orgId });
  const timeline = acts.ok ? (acts.data as any[]) : [];
  const pipesRes = await apiFetch("/pipelines", { orgId });
  const allPipes = pipesRes.ok ? ((pipesRes.data as any[]) ?? []) : [];
  const fuRes = await apiFetch(`/followups?view=all`, { orgId });
  const myFollowups = fuRes.ok ? ((fuRes.data as any).items ?? []).filter((f: any) => f.contactId === id) : [];
  const enRes = await apiFetch(`/contacts/${id}/enrollments`, { orgId });
  const myEnrollments = enRes.ok ? ((enRes.data as any[]) ?? []) : [];
  const seqRes = await apiFetch("/sequences", { orgId });
  const allSeqs = seqRes.ok ? ((seqRes.data as any[]) ?? []) : [];
  let members: Array<{ user: { id: string; name: string; email: string }; role: string }> | null = null;
  try {
    await requireMembership(session.user.id, orgId, true);
    members = await prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    });
  } catch {
    members = null;
  }

  return (
    <Shell>
      <div className="card">
        <p>
          <a href="/contacts">← Contacts</a>
        </p>
        <h2>
          {c.name} <span className="badge">{c.status}</span>
        </h2>
        <p>
          {c.phoneE164} · {c.email ?? "no email"} · Source: {c.source ?? "—"} · Referred by: {c.referredBy ?? "—"}
        </p>
        {c.status === "DNC" && (
          <p style={{ color: "var(--pg-overdue)" }}>
            <strong>Do Not Contact — all automated follow-up must stop.</strong>
          </p>
        )}

        <h3>Edit</h3>
        <form action={updateContact.bind(null, c.id)}>
          <p>
            <input name="name" defaultValue={c.name} required />
            <input name="phone" defaultValue={c.phoneE164} required />
          </p>
          <p>
            <input name="email" defaultValue={c.email ?? ""} placeholder="Email" />
            <input name="source" defaultValue={c.source ?? ""} placeholder="Source" />
            <input name="referredBy" defaultValue={c.referredBy ?? ""} placeholder="Referred by" />
          </p>
          <p>
            <select name="status" defaultValue={c.status}>
              {["ACTIVE", "INACTIVE", "ARCHIVED", "DNC"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {members ? (
              <select name="assignedAgentId" defaultValue={c.assignedAgentId ?? ""}>
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.name} ({m.role})
                  </option>
                ))}
              </select>
            ) : (
              <span>Assigned: {c.assignedAgentId ?? "—"}</span>
            )}
            <input name="nextActionAt" defaultValue={c.nextActionAt ? String(c.nextActionAt).slice(0, 16) : ""} placeholder="Next action (date)" />
          </p>
          <p>
            <textarea name="customFields" rows={3} cols={50} defaultValue={c.customFields ? JSON.stringify(c.customFields, null, 2) : ""} placeholder='Custom fields JSON, e.g. {"goal": "10k"}' />
          </p>
          <button type="submit">Save</button>
        </form>

        <h3>Tags</h3>
        <p>{(c.tags ?? []).map((t: any) => t.tag.name).join(", ") || "—"}</p>
        <form action={addTag.bind(null, c.id)}>
          <input name="name" placeholder="New tag" required />
          <button type="submit">Add tag</button>
        </form>
        {(c.tags ?? []).map((t: any) => (
          <form key={t.tag.id} action={removeTag.bind(null, c.id, t.tag.id)} style={{ display: "inline", marginRight: 8 }}>
            <button type="submit">✕ {t.tag.name}</button>
          </form>
        ))}

        <h3>Notes</h3>
        <form action={addNote.bind(null, c.id)}>
          <textarea name="body" rows={2} cols={50} placeholder="Private note (never shown to contact)" required />
          <br />
          <button type="submit">Add note</button>
        </form>
        <ul>
          {(c.notes ?? []).map((n: any) => (
            <li key={n.id}>
              {n.body} <small>({String(n.createdAt).slice(0, 10)})</small>
            </li>
          ))}
        </ul>

        <h3>Merge duplicate</h3>
        <form action={mergeContacts.bind(null, c.id)}>
          <input name="otherPhone" placeholder="Other contact's phone" required />
          <button type="submit">Find & merge into this contact</button>
        </form>

        <h3>Pipelines</h3>
        {(c.pipelines ?? []).map((e: any) => (
          <div key={e.id} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 8, marginTop: 8 }}>
            <p>
              <strong>{e.pipeline.name}</strong> · {e.stage.name} · {e.outcome}
              {e.outcomeReason ? ` (${e.outcomeReason})` : ""}
            </p>
            <form action={movePipeline.bind(null, c.id, e.pipelineId)}>
              <select name="stageId" defaultValue={e.stageId}>
                {(e.pipeline.stages ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button type="submit">Move</button>
            </form>
            <form action={outcomePipeline.bind(null, c.id, e.pipelineId)}>
              <select name="outcome" defaultValue={e.outcome}>
                <option value="ONGOING">Ongoing</option>
                <option value="CONVERTED">Converted</option>
                <option value="NOT_CONVERTED">Not converted</option>
              </select>
              <select name="reason" defaultValue={e.outcomeReason ?? ""}>
                <option value="">No reason</option>
                {NOT_CONVERTED_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button type="submit">Set outcome</button>
            </form>
            <form action={unenrollPipeline.bind(null, c.id, e.pipelineId)}>
              <button type="submit">Remove from pipeline</button>
            </form>
          </div>
        ))}
        <form action={enrollPipeline.bind(null, c.id)}>
          <select name="pipelineId" required defaultValue="">
            <option value="" disabled>
              Add to pipeline…
            </option>
            {allPipes.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit">Enroll</button>
        </form>

        <h3>Follow-ups</h3>
        <ul>
          {myFollowups.map((f: any) => (
            <li key={f.id}>
              {f.title} <small>(due {String(f.dueAt).slice(0, 16)}{f.doneAt ? ", done" : ""})</small>{" "}
              {!f.doneAt && (
                <form action={toggleFollowup.bind(null, f.id, true, `/contacts/${c.id}`)} style={{ display: "inline" }}>
                  <button type="submit">Done</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={createFollowup.bind(null, c.id)}>
          <input name="title" placeholder="e.g. Call tomorrow at 10 AM" required />
          <input name="dueAt" type="datetime-local" required />
          <button type="submit">Add follow-up</button>
        </form>

        <h3>Sequences</h3>
        <ul>
          {myEnrollments.map((e: any) => (
            <li key={e.id}>
              {e.sequence?.name} · {e.status} · step {e.currentStep}
            </li>
          ))}
        </ul>
        <form action={enrollSequence.bind(null, c.id)}>
          <select name="sequenceId" required defaultValue="">
            <option value="" disabled>
              Enroll in sequence…
            </option>
            {allSeqs.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="submit">Enroll</button>
        </form>

        <h3>Timeline</h3>
        <ul>
          {timeline.map((a: any) => (
            <li key={a.id}>
              {String(a.at).slice(0, 10)} — {a.type}
              {a.payload && a.payload.to ? ` (${a.payload.from} → ${a.payload.to})` : ""}
            </li>
          ))}
        </ul>
        <p>
          <small>Signed in as {session.user.email} ({myRole})</small>
        </p>
      </div>
    </Shell>
  );
}
