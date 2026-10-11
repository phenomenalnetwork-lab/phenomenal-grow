import { nav } from "@pgrow/config";

export default function Home() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Phenomenal Grow</h1>
        {nav.map((item) => (
          <a key={item} href="#">
            {item}
          </a>
        ))}
      </aside>
      <main className="main">
        <div className="card">
          <span className="badge">Phase 0 shell</span>
          <h2>Who needs me right now?</h2>
          <p>
            Action dashboard lands in Phase 5. This shell proves the monorepo,
            routing, and design tokens work end to end.
          </p>
          <p>
            API health: <code>/api/health</code> (proxied in Phase 0 exit).
          </p>
        </div>
      </main>
    </div>
  );
}
