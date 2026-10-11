import { redirect } from "next/navigation";
import { getSession, myMemberships } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { CreateOrgForm, InviteForm } from "../org-forms";
import { templatePipeline } from "../pipelines/actions";

/** Guided onboarding: working within minutes, never a blank system. */
export default async function Onboarding() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);

  const done: Record<string, boolean> = { org: ms.length > 0 };
  let orgId: string | null = ms[0]?.orgId ?? null;
  let numbers = 0;
  let pipelines = 0;
  let teammates = 0;
  if (orgId) {
    [numbers, pipelines, teammates] = await Promise.all([
      prisma.whatsappNumber.count({ where: { orgId } }),
      prisma.pipeline.count({ where: { orgId } }),
      prisma.membership.count({ where: { orgId, active: true } }),
    ]);
    done.number = numbers > 0;
    done.pipeline = pipelines > 0;
    done.team = teammates > 1;
  }
  if (done.org && done.number && done.pipeline && done.team) redirect("/");

  const numbersRes = orgId ? await apiFetch("/whatsapp/numbers", { orgId }) : null;

  return (
    <main className="main">
      <div className="card">
        <h2>Get working in minutes</h2>
        <ol>
          <li>
            {done.org ? "✓" : "1."} <strong>Name your organisation</strong>
            {!done.org && <CreateOrgForm />}
          </li>
          {orgId && (
            <>
              <li>
                {done.number ? "✓" : "2."} <strong>Connect a WhatsApp number</strong>
                {!done.number && (
                  <p>
                    <small>
                      In Meta: copy the Phone number ID + a permanent access token, then register it in Settings (or ask
                      your admin). Numbers: {numbersRes?.ok ? ((numbersRes.data as any[])?.length ?? 0) : 0} connected.
                    </small>
                  </p>
                )}
              </li>
              <li>
                {done.pipeline ? "✓" : "3."} <strong>Pick a starting journey</strong>
                {!done.pipeline && (
                  <p>
                    {(["business", "church", "coach"] as const).map((t) => (
                      <form key={t} action={templatePipeline.bind(null, t)} style={{ display: "inline", marginRight: 8 }}>
                        <button type="submit">Start with {t}</button>
                      </form>
                    ))}
                  </p>
                )}
              </li>
              <li>
                {done.team ? "✓" : "4."} <strong>Add your team</strong>
                {!done.team && <InviteForm orgId={orgId} />}
              </li>
              <li>
                5. <strong>Receive your first conversation</strong> — it lands in the Inbox with the contact created
                automatically.
              </li>
            </>
          )}
        </ol>
        <p>
          <a href="/">Skip to Home →</a>
        </p>
      </div>
    </main>
  );
}
