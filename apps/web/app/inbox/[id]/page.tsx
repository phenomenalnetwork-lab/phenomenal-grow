import { redirect, notFound } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId, requireMembership } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { Shell } from "../../shell";
import { replyToConversation, updateConversation, moveStageFromInbox } from "../actions";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const orgId = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!orgId) redirect("/");

  const { id } = await params;
  const res = await apiFetch(`/conversations/${id}`, { orgId });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) notFound();
    throw new Error((res.data as any)?.message ?? "Load failed");
  }
  const c = res.data as any;
  const enrollRes = await apiFetch(`/contacts/${c.contact?.id}/pipelines`, { orgId });
  const enrollments = enrollRes.ok ? ((enrollRes.data as any[]) ?? []) : [];

  let members: Array<{ user: { id: string; name: string }; role: string }> | null = null;
  try {
    await requireMembership(session.user.id, orgId, true);
    members = await prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    });
  } catch {
    members = null;
  }

  return (
    <Shell>
      <div className="card">
        <p>
          <a href="/inbox">← Inbox</a> · <a href={`/contacts/${c.contact?.id}`}>Open contact</a>
        </p>
        <h2>
          {c.contact?.name} <span className="badge">{c.status}</span>
          {c.needsReply && <span className="badge">needs reply</span>}
        </h2>
        <p>
          <small>
            {c.contact?.phoneE164} · {c.number?.label} · Source: {c.contact?.source ?? "—"} · Tags:{" "}
            {(c.contact?.tags ?? []).map((t: any) => t.tag.name).join(", ") || "—"}
          </small>
        </p>
        <ul>
          {(c.messages ?? []).map((m: any) => (
            <li key={m.id}>
              <strong>{m.direction === "IN" ? c.contact?.name : "Us"}:</strong> {m.body}{" "}
              <small>({String(m.sentAt).slice(0, 16)})</small>
            </li>
          ))}
        </ul>
        {c.status === "OPEN" ? (
          <form action={replyToConversation.bind(null, c.id)}>
            <textarea name="text" rows={3} cols={60} placeholder="Type a reply…" required />
            <br />
            <button type="submit">Reply via WhatsApp</button>
          </form>
        ) : (
          <p>
            <em>Closed — replying will reopen this conversation.</em>
          </p>
        )}
        <h3>Manage</h3>
        {enrollments.map((e: any) => (
          <form key={e.id} action={moveStageFromInbox.bind(null, c.id, c.contact.id, e.pipelineId)}>
            <span>
              {e.pipeline.name}:{" "}
            </span>
            <select name="stageId" defaultValue={e.stageId}>
              {(e.pipeline.stages ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit">Move stage</button>
          </form>
        ))}
        <form action={updateConversation.bind(null, c.id)}>
          <select name="status" defaultValue={c.status}>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
          {members && (
            <select name="assignedAgentId" defaultValue={c.assignedAgentId ?? ""}>
              <option value="">Unassigned</option>
              {members.map((m: any) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name} ({m.role})
                </option>
              ))}
            </select>
          )}
          <button type="submit">Save</button>
        </form>
      </div>
    </Shell>
  );
}
