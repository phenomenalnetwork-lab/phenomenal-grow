import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId, requireMembership } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { Shell } from "../shell";
import { CreateOrgForm, OrgSwitcher, InviteForm, AcceptInviteButton } from "../org-forms";
import { deactivateMember } from "./actions";
import { registerNumber, removeNumber, saveWebhookConfig, updateNumber } from "./numbers";
import { NumberTestButton } from "./numbers-test";

type NumberRow = {
  id: string;
  label: string;
  providerNumberId: string;
  businessAccountId?: string | null;
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
};
type WebhookConfig = { configured: boolean; hasVerifyToken: boolean; hasAppSecret: boolean; updatedAt: string | null };

function testBadge(n: NumberRow) {
  if (!n.lastTestedAt) return "Saved — not yet tested";
  const when = new Date(n.lastTestedAt).toLocaleString();
  return n.lastTestOk ? `Tested OK · ${when}` : `Last test failed · ${when} — run Test connection`;
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const memberships = await myMemberships(session.user.id);
  const activeId = await getActiveOrgId();
  const active = memberships.find((m) => m.orgId === activeId) ?? memberships[0] ?? null;

  let members: Array<{ user: { id: string; name: string; email: string }; role: string; active: boolean }> = [];
  let invites: Array<{ id: string; email: string; role: string; token: string; acceptedAt: Date | null }> = [];
  let numbers: Array<NumberRow> = [];
  let webhookConfig: WebhookConfig | null = null;
  let isOwner = false;
  const verifyTokenConfigured = Boolean(process.env.WHATSAPP_VERIFY_TOKEN);
  const fallbackTemplate = process.env.WHATSAPP_FALLBACK_TEMPLATE?.trim() || "";
  if (active) {
    try {
      await requireMembership(session.user.id, active.orgId, true);
      isOwner = true;
      members = await prisma.membership.findMany({
        where: { orgId: active.orgId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: "asc" } },
      });
      invites = await prisma.invite.findMany({
        where: { orgId: active.orgId },
        orderBy: { createdAt: "desc" },
      });
      const numRes = await apiFetch<any[]>("/whatsapp/numbers", { orgId: active.orgId });
      if (numRes.ok) numbers = numRes.data ?? [];
      const cfgRes = await apiFetch<WebhookConfig>("/whatsapp/config", { orgId: active.orgId });
      // Config endpoint is new: older API builds return 404 — treat as unconfigured.
      if (cfgRes.ok) webhookConfig = cfgRes.data;
    } catch {
      members = [];
    }
  }
  const pending = await prisma.invite.findMany({
    where: { email: session.user.email.toLowerCase(), acceptedAt: null },
    include: { org: { select: { name: true } } },
  });

  return (
    <Shell accent="settings">
      <div className="card card-accent">
        <h2>Settings</h2>
        <h3>Organisation</h3>
        <OrgSwitcher orgs={memberships.map((m) => ({ id: m.orgId, name: m.org.name }))} activeId={active?.orgId ?? null} />
        <h3>Create organisation</h3>
        <CreateOrgForm />
        {active && isOwner && (
          <>
            <h3>Meta integration (manual setup)</h3>
            <p>
              Connect each WhatsApp number manually from Meta → WhatsApp → API Setup. Tokens are encrypted at rest and
              never shown again — leave secret fields blank when editing to keep the stored values.
            </p>
            <h4>Organisation webhook</h4>
            <ul>
              <li>Tenant callback path: <code>/whatsapp/webhook/org/{active.orgId}</code> (point this org&apos;s Meta app at your public API URL + this path)</li>
              <li>Verify token: {webhookConfig?.hasVerifyToken ? "set" : "not set"} · App secret: {webhookConfig?.hasAppSecret ? "set" : "not set"}
                {webhookConfig?.updatedAt ? ` · updated ${new Date(webhookConfig.updatedAt).toLocaleString()}` : ""} (values never displayed)</li>
              <li>Legacy shared path <code>/whatsapp/webhook</code> keeps working with the global env tokens.</li>
            </ul>
            <form action={saveWebhookConfig}>
              <input name="verifyToken" placeholder="Verify token — new value (blank = keep)" size={30} />
              <input name="appSecret" placeholder="App secret — new value (blank = keep)" size={30} />
              <button type="submit">Save webhook secrets</button>
            </form>
            <h4>Global fallbacks (env)</h4>
            <ul>
              <li>Verify token: {verifyTokenConfigured ? "configured" : "missing — set WHATSAPP_VERIFY_TOKEN"} (value never displayed)</li>
              <li>Fallback template: {fallbackTemplate ? <code>{fallbackTemplate}</code> : "not set — out-of-window replies send as text"}</li>
            </ul>
            <h3>WhatsApp numbers</h3>
            <ul>
              {numbers.map((n) => (
                <li key={n.id}>
                  {n.label} ({n.providerNumberId}
                  {n.businessAccountId ? ` · WABA ${n.businessAccountId}` : ""}) · {testBadge(n)}{" "}
                  <NumberTestButton id={n.id} />{" "}
                  <form action={removeNumber.bind(null, n.id)} style={{ display: "inline" }}>
                    <button type="submit">Disconnect</button>
                  </form>
                  <p>Disconnect is blocked while the number has conversation history, so contacts and messages are never deleted by accident.</p>
                  <details>
                    <summary>Edit</summary>
                    <form action={updateNumber.bind(null, n.id)}>
                      <input name="label" defaultValue={n.label} placeholder="Label" required />
                      <input name="providerNumberId" defaultValue={n.providerNumberId} placeholder="Phone number ID" required />
                      <input name="businessAccountId" defaultValue={n.businessAccountId ?? ""} placeholder="Business Account ID (optional)" />
                      <input name="accessToken" placeholder="New token (blank = keep)" size={30} />
                      <button type="submit">Save</button>
                    </form>
                    <p>Changing the Phone Number ID requires re-entering the access token.</p>
                  </details>
                </li>
              ))}
            </ul>
            <form action={registerNumber}>
              <input name="label" placeholder="Label (e.g. Sales)" required />
              <input name="providerNumberId" placeholder="Phone number ID from Meta" required />
              <input name="businessAccountId" placeholder="Business Account ID (optional)" />
              <input name="accessToken" placeholder="Permanent access token from Meta" required size={40} />
              <button type="submit">Connect number</button>
            </form>
          </>
        )}
        {active && members.length > 0 && (
          <>
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
