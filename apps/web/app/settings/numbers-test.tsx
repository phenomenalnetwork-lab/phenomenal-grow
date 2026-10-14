"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { testNumber } from "./numbers";

export function NumberTestButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setState(await testNumber(id));
            router.refresh();
          } catch (e) {
            setState({ ok: false, detail: (e as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Testing…" : "Test connection"}
      </button>
      {state && (
        <span role="status" style={{ color: state.ok ? "green" : "red" }}>
          {state.detail}
        </span>
      )}
    </span>
  );
}
