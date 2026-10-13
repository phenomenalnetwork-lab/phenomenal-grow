import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { NOTIFICATION_KINDS } from "@pgrow/types";
import { Shell } from "../shell";
import { markRead, markAllRead, setPreference } from "./actions";
import { PushSubscribe } from "./push-subscribe";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const m = (active && ms.find((x) => x.orgId === active)) ?? ms[0];
  if (!m) redirect("/");

  const res = await apiFetch<any>("/notifications?take=50", { orgId: m.orgId });
  const list = res.ok ? res.data : { items: [], unread: 0 };
  const prefsRes = await apiFetch<any[]>("/notifications/preferences", { orgId: m.orgId });
  const prefs = new Map((prefsRes.ok ? prefsRes.data ?? [] : []).map((p: any) => [p.kind, p.enabled]));

  return (
    <Shell accent="notifications">
      <div className="card card-accent">
        <h2>Notifications ({list.unread} unread)</h2>
        <form action={markAllRead}>
          <button type="submit">Mark all read</button>
        </form>
        <ul>
          {list.items.map((n: any) => (
            <li key={n.id} style={{ fontWeight: n.readAt ? "normal" : "bold" }}>
              [{n.kind}] {n.title} {n.body ? `— ${n.body}` : ""}{" "}
              {n.link && <a href={n.link}>Open →</a>}{" "}
              {!n.readAt && (
                <form action={markRead.bind(null, n.id)} style={{ display: "inline" }}>
                  <button type="submit">Mark read</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {list.items.length === 0 && <p>No notifications. Only actions interrupt you here.</p>}
        <h3>Preferences</h3>
        <PushSubscribe />
        {NOTIFICATION_KINDS.map((k) => (
          <form key={k} action={setPreference.bind(null, k)}>
            <label>
              <input type="checkbox" name="enabled" defaultChecked={prefs.get(k) ?? true} /> {k}
            </label>
            <button type="submit">Save</button>
          </form>
        ))}
      </div>
    </Shell>
  );
}
