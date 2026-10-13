import { cookies } from "next/headers";
import { nav } from "@pgrow/config";
import { getSession } from "@/lib/orgs";
import { prisma } from "@/lib/prisma";
import { ACTIVE_ORG_COOKIE } from "@/lib/orgs";
import { Logo } from "./logo";

const hrefs: Record<string, string> = {
  Home: "/",
  Inbox: "/inbox",
  Contacts: "/contacts",
  Pipelines: "/pipelines",
  "Follow-ups": "/followups",
  Appointments: "/appointments",
  Reports: "/reports",
  Settings: "/settings",
};

const extraLinks = [{ label: "Capture Forms", href: "/forms" }];

export async function Shell({ children, accent = "home" }: { children: React.ReactNode; accent?: string }) {
  let unread = 0;
  try {
    const session = await getSession();
    const orgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
    if (session && orgId) {
      unread = await prisma.notification.count({ where: { orgId, userId: session.user.id, readAt: null } });
    }
  } catch {
    unread = 0;
  }
  return (
    <div className={`shell area-${accent}`}>
      <aside className="sidebar">
        <h1>
          <Logo />
        </h1>
        <p className="tagline">Turn conversations into growth</p>
        <nav>
          {nav.map((item) => (
            <a key={item} href={hrefs[item] ?? "/"}>
              {item}
            </a>
          ))}
          {extraLinks.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
          <a href="/notifications">
            Notifications{unread > 0 ? <span className="count">{unread}</span> : ""}
          </a>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
