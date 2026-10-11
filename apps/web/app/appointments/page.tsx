import { redirect } from "next/navigation";
import { getSession, myMemberships, getActiveOrgId } from "@/lib/orgs";
import { apiFetch } from "@/lib/api";
import { Shell } from "../shell";
import { createAppointmentByPhone, updateAppointment } from "./actions";

const VIEWS = [
  ["today", "Today"],
  ["upcoming", "Upcoming"],
  ["mine", "Assigned to Me"],
  ["all", "All"],
] as const;

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ms = await myMemberships(session.user.id);
  const active = await getActiveOrgId();
  const orgId = (active && ms.some((m) => m.orgId === active) ? active : ms[0]?.orgId) ?? null;
  if (!orgId) redirect("/");

  const sp = await searchParams;
  const view = (sp.view as string) || "today";
  const res = await apiFetch(`/appointments?view=${encodeURIComponent(view)}`, { orgId });
  const items = res.ok ? ((res.data as any[]) ?? []) : [];

  return (
    <Shell>
      <div className="card">
        <h2>Appointments</h2>
        <p>
          {VIEWS.map(([v, label]) => (
            <a key={v} href={`/appointments?view=${v}`} style={{ marginRight: 10, fontWeight: view === v ? "bold" : "normal" }}>
              {label}
            </a>
          ))}
        </p>
        {!res.ok && <p style={{ color: "var(--pg-overdue)" }}>Load failed</p>}
        <ul>
          {items.map((a: any) => (
            <li key={a.id}>
              <a href={`/contacts/${a.contactId}`}>{a.contact?.name}</a> — {String(a.date).slice(0, 10)}{a.time ? ` ${a.time}` : ""}{" "}
              {a.type ? `· ${a.type} ` : ""}· {a.status}{" "}
              {a.status === "SCHEDULED" && (
                <>
                  <form action={updateAppointment.bind(null, a.id, "COMPLETED", `/appointments?view=${view}`)} style={{ display: "inline", marginLeft: 8 }}>
                    <button type="submit">Complete</button>
                  </form>
                  <form action={updateAppointment.bind(null, a.id, "NOSHOW", `/appointments?view=${view}`)} style={{ display: "inline", marginLeft: 8 }}>
                    <button type="submit">No-show</button>
                  </form>
                  <form action={updateAppointment.bind(null, a.id, "CANCELLED", `/appointments?view=${view}`)} style={{ display: "inline", marginLeft: 8 }}>
                    <button type="submit">Cancel</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
        {items.length === 0 && <p>No appointments here.</p>}
        <h3>Book appointment</h3>
        <form action={createAppointmentByPhone}>
          <input name="phone" placeholder="Contact phone" required />
          <input name="date" type="date" required />
          <input name="time" placeholder="10:00" />
          <input name="type" placeholder="Type (e.g. Consultation)" />
          <button type="submit">Book</button>
        </form>
      </div>
    </Shell>
  );
}
