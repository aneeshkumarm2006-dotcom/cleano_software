"use client";

import { useEffect, useState } from "react";
import { X, Download, Share } from "lucide-react";
import { useInstall } from "./InstallContext";

// Bumped from -dismissed → -dismissed-v2 so previously-dismissed users see the
// banner again after this change. Re-show 14 days after a fresh dismiss.
const DISMISS_KEY = "cleano:install-dismissed-v2";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Floating "Install Cleano" card. Renders if Chrome captured a
 * beforeinstallprompt or if the user is on iOS Safari (where we show
 * manual Add-to-Home-Screen instructions). Dismissible — but the user
 * can always re-install from the drawer's "Install app" entry.
 */
export default function InstallPrompt({ appName = "the app" }: { appName?: string }) {
  const { canInstall, isStandalone, isIOSSafari, install } = useInstall();
  const [dismissed, setDismissed] = useState(true); // start hidden until we read storage

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) {
      setDismissed(false);
      return;
    }
    const elapsed = Date.now() - Number(ts);
    setDismissed(Number.isFinite(elapsed) && elapsed < DISMISS_COOLDOWN_MS);
  }, []);

  const visible = !isStandalone && !dismissed && (canInstall || isIOSSafari);

  /**
   * Tell the page it is there.
   *
   * The card is `position: fixed` above the tab bar, and nothing reserved room
   * for it — so it sat on top of whatever was at the bottom of the list. On the
   * cleaner's job list that is the job card and its "Complete job" button, and
   * a tap aimed at the button landed on "Install" instead. Playwright could not
   * click through it at all: eight retries, every one reporting
   * `<button class="cl-install-btn"> intercepts pointer events`.
   *
   * A floating card may cover empty space. It may not cover the control it is
   * floating over.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (visible) root.dataset.installPrompt = "1";
    else delete root.dataset.installPrompt;
    return () => {
      delete root.dataset.installPrompt;
    };
  }, [visible]);

  if (!visible) return null;

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  const onInstall = async () => {
    const ok = await install();
    if (ok) setDismissed(true);
  };

  return (
    <div className="cl-install-prompt" role="dialog" aria-live="polite">
      <div className="cl-install-icon">
        {isIOSSafari && !canInstall ? <Share size={18} /> : <Download size={18} />}
      </div>
      <div className="cl-install-body">
        <strong>Install {appName}</strong>
        <span>
          {canInstall
            ? `Add ${appName} to your phone for the full app experience.`
            : "Tap Share, then Add to Home Screen."}
        </span>
      </div>
      <div className="cl-install-actions">
        {canInstall && (
          <button type="button" className="cl-install-btn" onClick={onInstall}>
            Install
          </button>
        )}
        <button
          type="button"
          className="cl-install-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
