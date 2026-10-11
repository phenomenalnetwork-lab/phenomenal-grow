"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
  return res.json();
}

export function CreateOrgForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const org = await post("/api/orgs", { name });
          await post("/api/orgs/active", { orgId: org.id });
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed");
        }
      }}
    >
      <input placeholder="New organisation name" value={name} onChange={(e) => setName(e.target.value)} required />
      <button type="submit">Create</button>
      {error && <p style={{ color: "var(--pg-overdue)" }}>{error}</p>}
    </form>
  );
}

export function OrgSwitcher({ orgs, activeId }: { orgs: { id: string; name: string }[]; activeId: string | null }) {
  const router = useRouter();
  if (orgs.length === 0) return <p>No organisations yet — create one below.</p>;
  return (
    <select
      value={activeId ?? ""}
      onChange={async (e) => {
        await post("/api/orgs/active", { orgId: e.target.value });
        router.refresh();
      }}
    >
      {!activeId && <option value="">Select organisation…</option>}
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function InviteForm({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const invite = await post(`/api/orgs/${orgId}/invites`, { email, role: "AGENT" });
          setToken(invite.token);
          setEmail("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed");
        }
      }}
    >
      <input type="email" placeholder="agent@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button type="submit">Invite agent</button>
      {error && <p style={{ color: "var(--pg-overdue)" }}>{error}</p>}
      {token && (
        <p>
          Share this link (email sending arrives later): <code>/login?invite={token}</code>
        </p>
      )}
    </form>
  );
}

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        onClick={async () => {
          try {
            const res = await post(`/api/invites/${token}/accept`, {});
            await post("/api/orgs/active", { orgId: res.orgId });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Failed");
          }
        }}
      >
        Accept
      </button>
      {error && <p style={{ color: "var(--pg-overdue)" }}>{error}</p>}
    </>
  );
}
