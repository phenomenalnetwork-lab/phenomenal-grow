import { nav } from "@pgrow/config";

const hrefs: Record<string, string> = {
  Home: "/",
  Inbox: "/contacts",
  Contacts: "/contacts",
  Pipelines: "/contacts",
  "Follow-ups": "/contacts",
  Appointments: "/contacts",
  Reports: "/contacts",
  Settings: "/",
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
