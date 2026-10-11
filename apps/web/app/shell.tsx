import { nav } from "@pgrow/config";

const hrefs: Record<string, string> = {
  Home: "/",
  Inbox: "/inbox",
  Contacts: "/contacts",
  Pipelines: "/pipelines",
  "Follow-ups": "/followups",
  Appointments: "/contacts",
  Reports: "/contacts",
  Settings: "/settings",
};

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
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
