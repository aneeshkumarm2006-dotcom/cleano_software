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

    let reloading = false;

    // When a new service worker takes control, the page is still running the
    // OLD JavaScript. Reload once so the app actually becomes the new version.
    // Guarded so we can't loop.
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          // Pull in a new worker promptly after a deploy.
          reg.update().catch(() => {});

          // A waiting worker means a new version is downloaded but parked
          // behind the running one. Tell it to take over immediately.
          const promote = () => reg.waiting?.postMessage("SKIP_WAITING");
          if (reg.waiting) promote();
          reg.addEventListener("updatefound", () => {
            const incoming = reg.installing;
            incoming?.addEventListener("statechange", () => {
              if (incoming.state === "installed" && navigator.serviceWorker.controller) {
                promote();
              }
            });
          });

          // An installed app is usually RESUMED from the background rather
          // than freshly launched, so it can run a months-old bundle for
          // weeks without ever re-checking. Check on every foreground, and
          // hourly while it stays open.
          const checkForUpdate = () => reg.update().catch(() => {});
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkForUpdate();
          });
          window.addEventListener("focus", checkForUpdate);
          window.setInterval(checkForUpdate, 60 * 60 * 1000);
        })
        .catch((err) => console.error("service worker registration failed", err));
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);

    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
