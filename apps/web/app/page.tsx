import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { prisma } from "@/lib/prisma";
import { Shell } from "./shell";
import { CreateOrgForm, OrgSwitcher, InviteForm, AcceptInviteButton } from "./org-forms";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");

  const memberships = await myMemberships(session.user.id);
  const activeId = await getActiveOrgId();
  const active = memberships.find((m) => m.orgId === activeId) ?? memberships[0] ?? null;
  const pending = await prisma.invite.findMany({
    where: { email: session.user.email.toLowerCase(), acceptedAt: null },
    include: { org: { select: { name: true } } },
  });

  return (
    <Shell>
      <div className="card">
        <span className="badge">Phase 1</span>
        <h2>Who needs me right now?</h2>
        <p>
          Signed in as {session.user.email} · Action dashboard lands in Phase 5.
        </p>
        <p>
          <a href="/contacts">Go to Contacts →</a>
        </p>
        <h3>Organisation</h3>
        <OrgSwitcher orgs={memberships.map((m) => ({ id: m.orgId, name: m.org.name }))} activeId={active?.orgId ?? null} />
        <h3>Create organisation</h3>
        <CreateOrgForm />
        {active && active.role === "OWNER" && (
          <>
            <h3>Invite agent to {active.org.name}</h3>
            <InviteForm orgId={active.orgId} />
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
