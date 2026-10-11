"use client";
import { useState } from "react";
import { signIn, signUp, useSession, signOut } from "@/lib/auth-client";

export default function LoginPage() {
  const { data: session, isPending } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (isPending) return <main className="main"><p>Loading…</p></main>;

  if (session) {
    return (
      <main className="main">
        <div className="card">
          <h2>Signed in as {session.user.email}</h2>
          <p>Organisation switching lands next in Phase 0 (membership-gated).</p>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
      </main>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res =
      mode === "in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name });
    if (res.error) setError(res.error.message ?? "Authentication failed");
    else window.location.href = "/";
  };

  return (
    <main className="main">
      <div className="card">
        <h2>{mode === "in" ? "Sign in" : "Create account"}</h2>
        <form onSubmit={submit}>
          {mode === "up" && (
            <p>
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            </p>
          )}
          <p>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </p>
          <p>
            <input type="password" placeholder="Password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </p>
          {error && <p style={{ color: "var(--pg-overdue)" }}>{error}</p>}
          <button type="submit">{mode === "in" ? "Sign in" : "Sign up"}</button>
        </form>
        <p>
          <button onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
