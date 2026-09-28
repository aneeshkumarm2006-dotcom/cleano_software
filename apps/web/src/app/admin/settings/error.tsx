"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Route error boundary for /admin/settings (and /cleaners/settings, which
 * re-exports the same page).
 *
 * Why this file exists: an uncaught server error in this route used to render
 * Next's bare error screen — a blank page with "Application error: a
 * server-side exception has occurred" and no way forward but the back button.
 * That screen IS what the client reports as "the settings page returns an
 * error", whatever actually threw.
 *
 * The page itself now degrades section by section (see `settledSection` in
 * page.tsx), so reaching this boundary means something outside those queries
 * failed — the session lookup, the render, a serialization fault. It gives the
 * admin the two things the bare screen doesn't: a plain description and a
 * Retry that re-runs the server component without a full reload.
 */
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Vercel captures this alongside the server-side stack, and `digest` is the
    // id that ties the two together — it is the only handle support has on a
    // production error whose message the client never sees.
    console.error("[settings] route error", error);
  }, [error]);

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="admin-font stack-24" style={{ maxWidth: 640 }}>
        <header className="stack-8">
          <p className="eyebrow">Settings</p>
          <h1 className="display">This page didn&apos;t load</h1>
        </header>

        <div className="cl-section-card">
          <div className="cl-section-card-head">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="icon-bubble">
                <AlertTriangle className="w-5 h-5" strokeWidth={1.9} />
              </span>
              <div>
                <h3>Something went wrong loading your settings</h3>
                <p>
                  Your settings are safe — nothing was changed. This is usually
                  temporary.
                </p>
              </div>
            </div>
          </div>
          <div className="cl-section-card-body stack-16">
            <button
              type="button"
              className="cl-form-save"
              onClick={() => reset()}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <RotateCw className="w-4 h-4" strokeWidth={2} />
              Try again
            </button>
            {error.digest && (
              <p style={{ fontSize: 12, color: "var(--primary-70)" }}>
                If it keeps happening, quote this reference to support:{" "}
                <code>{error.digest}</code>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
