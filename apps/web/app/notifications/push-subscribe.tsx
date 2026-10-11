"use client";
import { useState } from "react";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushSubscribe() {
  const [state, setState] = useState<string | null>(null);

  const enable = async () => {
    try {
      setState(null);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("Push not supported in this browser.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("Permission denied.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/public-key");
      const { key } = (await keyRes.json()) as { key: string | null };
      if (!key) {
        setState("Push is not configured on the server yet.");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
      });
      setState(res.ok ? "Push enabled on this device." : "Subscribe failed.");
    } catch (e) {
      setState(e instanceof Error ? e.message : "Subscribe failed.");
    }
  };

  return (
    <div>
      <button onClick={enable}>Enable push on this device</button>
      {state && <p>{state}</p>}
    </div>
  );
}
