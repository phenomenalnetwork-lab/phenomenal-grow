"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

/** Sidebar sign-out. Uses Better Auth sign-out so the server session is
 * revoked — never just a cookie delete. Lands on /login on success. */
export function SignOutButton() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button
        className="secondary inline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          try {
            await signOut({
              fetchOptions: {
                onSuccess: () => router.push("/login"),
                onError: () => setFailed(true),
              },
            });
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <span role="alert">
          <small>Sign-out failed — please retry.</small>
        </span>
      )}
    </span>
  );
}
