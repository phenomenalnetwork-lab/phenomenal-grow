"use client";
import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Last-known subscription endpoint, used ONLY as a cleanup hint so a server
 * record can still be deleted after the browser subscription is gone.
 * Never authorization: the server still scopes deletion to the session user.
 */
const ENDPOINT_KEY = "pgrow-push-endpoint";

function readStoredEndpoint(): string | null {
  try {
    return window.localStorage.getItem(ENDPOINT_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredEndpoint(endpoint: string): void {
  try {
    window.localStorage.setItem(ENDPOINT_KEY, endpoint);
  } catch {
    // Storage unavailable (e.g. private mode): retry still works while this tab lives.
  }
}

function clearStoredEndpoint(): void {
  try {
    window.localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    // Best effort only.
  }
}

type Status = { checking: boolean; subscribed: boolean; busy: boolean; message: string | null };

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function PushSubscribe() {
  const [state, setState] = useState<Status>({ checking: true, subscribed: false, busy: false, message: null });

  useEffect(() => {
    let cancelled = false;
    currentSubscription()
      .then((sub) => {
        if (cancelled) return;
        if (sub) writeStoredEndpoint(sub.endpoint);
        setState((s) => ({ ...s, checking: false, subscribed: sub !== null }));
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, checking: false, subscribed: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    try {
      setState((s) => ({ ...s, busy: true, message: null }));
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState((s) => ({ ...s, busy: false, message: "Push not supported in this browser." }));
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => ({ ...s, busy: false, message: "Permission denied." }));
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/public-key");
      const { key } = (await keyRes.json()) as { key: string | null };
      if (!key) {
        setState((s) => ({ ...s, busy: false, message: "Push is not configured on the server yet." }));
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
      });
      if (!res.ok) {
        // Server record missing: roll the local subscription back so the
        // device state stays truthful. Keep the endpoint hint only if the
        // rollback itself failed, so cleanup can be retried.
        let rolledBack = false;
        try {
          rolledBack = await sub.unsubscribe();
        } catch {
          rolledBack = false;
        }
        if (rolledBack) clearStoredEndpoint();
        else writeStoredEndpoint(sub.endpoint);
        setState((s) => ({ ...s, busy: false, subscribed: false, message: "Subscribe failed on the server." }));
        return;
      }
      writeStoredEndpoint(sub.endpoint);
      setState((s) => ({ ...s, busy: false, subscribed: true, message: "Push enabled on this device." }));
    } catch (e) {
      setState((s) => ({ ...s, busy: false, message: e instanceof Error ? e.message : "Subscribe failed." }));
    }
  };

  const disable = async () => {
    try {
      setState((s) => ({ ...s, busy: true, message: null }));
      const sub = await currentSubscription();
      // Prefer the live endpoint; fall back to the stored hint when the
      // browser subscription is already gone.
      const endpoint = sub?.endpoint ?? readStoredEndpoint();
      if (!endpoint) {
        setState((s) => ({
          ...s,
          busy: false,
          subscribed: false,
          message: "No push subscription on this device and no saved server record to clean up.",
        }));
        return;
      }
      if (sub) {
        let deviceRemoved = false;
        try {
          deviceRemoved = await sub.unsubscribe();
        } catch {
          deviceRemoved = false;
        }
        if (!deviceRemoved) {
          setState((s) => ({ ...s, busy: false, message: "Could not disable push on this device — please retry." }));
          return;
        }
      }
      const res = await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) {
        // Retain the hint so server-side deletion can be retried. Never
        // claim an orphan was deleted.
        writeStoredEndpoint(endpoint);
        setState((s) => ({
          ...s,
          busy: false,
          subscribed: false,
          message: sub
            ? "Removed on this device, but the server record may remain — please retry."
            : "No local subscription found, and server cleanup failed — please retry.",
        }));
        return;
      }
      clearStoredEndpoint();
      setState((s) => ({
        ...s,
        busy: false,
        subscribed: false,
        message: sub
          ? "Push disabled on this device."
          : "No local subscription found; saved server record removed.",
      }));
    } catch (e) {
      setState((s) => ({ ...s, busy: false, message: e instanceof Error ? e.message : "Unsubscribe failed." }));
    }
  };

  if (state.checking) {
    return (
      <div>
        <button disabled>Push…</button>
      </div>
    );
  }

  return (
    <div>
      {state.subscribed ? (
        <button onClick={disable} disabled={state.busy}>
          {state.busy ? "Working…" : "Disable push on this device"}
        </button>
      ) : (
        <button onClick={enable} disabled={state.busy}>
          {state.busy ? "Working…" : "Enable push on this device"}
        </button>
      )}
      {state.message && <p>{state.message}</p>}
    </div>
  );
}
