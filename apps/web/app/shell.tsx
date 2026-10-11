import { nav } from "@pgrow/config";

const hrefs: Record<string, string> = {
  Home: "/",
  Inbox: "/inbox",
  Contacts: "/contacts",
  Pipelines: "/pipelines",
  "Follow-ups": "/followups",
  Appointments: "/appointments",
  Reports: "/contacts",
  Settings: "/settings",
};

const extraLinks = [{ label: "Capture Forms", href: "/forms" }];

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Phenomenal Grow</h1>
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
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
