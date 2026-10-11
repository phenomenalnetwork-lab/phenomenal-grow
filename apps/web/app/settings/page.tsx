import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId, requireMembership } from "@/lib/orgs";
import { prisma } from "@/lib/prisma";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { CreateOrgForm, OrgSwitcher, InviteForm, AcceptInviteButton } from "../org-forms";
import { deactivateMember } from "./actions";
import { registerNumber, removeNumber } from "./numbers";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const memberships = await myMemberships(session.user.id);
  const activeId = await getActiveOrgId();
  const active = memberships.find((m) => m.orgId === activeId) ?? memberships[0] ?? null;

  let members: Array<{ user: { id: string; name: string; email: string }; role: string; active: boolean }> = [];
  let invites: Array<{ id: string; email: string; role: string; token: string; acceptedAt: Date | null }> = [];
  if (active) {
    try {
      await requireMembership(session.user.id, active.orgId, true);
      members = await prisma.membership.findMany({
        where: { orgId: active.orgId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      });
      invites = await prisma.invite.findMany({
        where: { orgId: active.orgId },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      members = [];
    }
  }
  const pending = await prisma.invite.findMany({
    where: { email: session.user.email.toLowerCase(), acceptedAt: null },
    include: { org: { select: { name: true } } },
  });
  const numbersRes = active ? await apiFetch<any[]>("/whatsapp/numbers", { orgId: active.orgId }) : null;
  const numbers = numbersRes?.ok ? (numbersRes.data ?? []) : [];

  return (
    <Shell>
      <div className="card">
        <h2>Settings</h2>
        <h3>Organisation</h3>
        <OrgSwitcher orgs={memberships.map((m) => ({ id: m.orgId, name: m.org.name }))} activeId={active?.orgId ?? null} />
        <h3>Create organisation</h3>
        <CreateOrgForm />
        {active && members.length > 0 && (
          <>
            <h3>WhatsApp numbers</h3>
            <ul>
              {numbers.map((n: any) => (
                <li key={n.id}>
                  {n.label} ({n.providerNumberId})
                  <form action={removeNumber.bind(null, n.id)} style={{ display: "inline", marginLeft: 8 }}>
                    <button type="submit">Disconnect</button>
                  </form>
                </li>
              ))}
            </ul>
            <form action={registerNumber}>
              <input name="label" placeholder="Label e.g. Sales" required />
              <input name="providerNumberId" placeholder="Phone number ID from Meta" required />
              <input name="accessToken" placeholder="Access token from Meta" required />
              <button type="submit">Connect number</button>
            </form>
            <h3>Team — {active.org.name}</h3>
            <ul>
              {members.map((m) => (
                <li key={m.user.id}>
                  {m.user.name} ({m.user.email}) · {m.role} · {m.active ? "active" : "deactivated"}
                  {m.active && m.user.id !== session.user.id && (
                    <form action={deactivateMember.bind(null, m.user.id)}>
                      <select name="reassignTo" defaultValue="">
                        <option value="">Leave unassigned</option>
                        {members
                          .filter((x) => x.active && x.user.id !== m.user.id)
                          .map((x) => (
                            <option key={x.user.id} value={x.user.id}>
                              Reassign to {x.user.name}
                            </option>
                          ))}
                      </select>
                      <button type="submit">Deactivate</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <h3>Invite agent</h3>
            <InviteForm orgId={active.orgId} />
            {invites.length > 0 && (
              <>
                <h4>Invites</h4>
                <ul>
                  {invites.map((i) => (
                    <li key={i.id}>
                      {i.email} ({i.role}) · {i.acceptedAt ? "accepted" : `pending — share: /login?invite=${i.token}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {pending.length > 0 && (
          <>
            <h3>Pending invites</h3>
            <ul>
              {pending.map((i) => (
                <li key={i.id}>
                  {i.org.name} ({i.role}) <AcceptInviteButton token={i.token} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Shell>
  );
}
