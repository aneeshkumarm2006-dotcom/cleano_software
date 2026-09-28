"use client";

import { useEffect } from "react";

const INTERVAL_MS = 20_000;

/**
 * Mounted once in the authenticated app shell. POSTs /api/presence/ping
 * every 20s while the tab is visible. Used to power WhatsApp-style chat
 * receipts (online = pinged within last ~60s) and to throttle chat email
 * notifications when the recipient is already active.
 */
export default function PresenceHeartbeat() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    function ping() {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fetch("/api/presence/ping", { method: "POST", credentials: "include" }).catch(() => {});
    }

    // Initial ping on mount.
    ping();
    timer = setInterval(ping, INTERVAL_MS);

    // Ping again whenever the tab becomes visible (catches phone wake-ups).
    function onVisibility() {
      if (document.visibilityState === "visible") ping();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
