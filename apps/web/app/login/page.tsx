"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signUp, useSession, signOut } from "@/lib/auth-client";

function LoginInner() {
  const { data: session, isPending } = useSession();
  const params = useSearchParams();
  const invite = params.get("invite");
  const [mode, setMode] = useState<"in" | "up">(params.get("mode") === "up" ? "up" : "in");
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
          <p>
            <a href="/">Go to Home →</a> · <a href="/settings">Settings →</a>
          </p>
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
    if (res.error) {
      setError(res.error.message ?? "Authentication failed");
      return;
    }
    if (invite) {
      const acc = await fetch(`/api/invites/${invite}/accept`, { method: "POST" });
      if (!acc.ok) {
        setError("Signed in, but the invite could not be accepted (wrong email or expired).");
        return;
      }
    }
    window.location.href = "/";
  };

  return (
    <main className="main">
      <div className="card">
        <h2>{mode === "in" ? "Sign in" : "Create account"}</h2>
        {invite && <p>You were invited — sign in or create your account to join.</p>}
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
