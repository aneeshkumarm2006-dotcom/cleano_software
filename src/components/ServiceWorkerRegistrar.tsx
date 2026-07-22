"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js.
 *
 * This is what makes the site installable: Chrome only fires
 * `beforeinstallprompt` (and only creates a real standalone home-screen app
 * rather than a browser bookmark) when a service worker with a fetch handler
 * is registered. Without it, "Add to Home screen" opened inside Chrome's UI.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Registering during dev fights with hot reload; production only.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Pull in a new worker promptly after a deploy.
          reg.update().catch(() => {});
        })
        .catch((err) => console.error("service worker registration failed", err));
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
