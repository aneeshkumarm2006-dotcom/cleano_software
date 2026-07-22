"use client";

import { Download, Share, CheckCircle2, Smartphone } from "lucide-react";
import { useInstall } from "./InstallContext";

/**
 * Always-visible "Install app" card for Settings / login pages.
 *
 * The floating InstallPrompt is dismissible (and hidden for 14 days after a
 * dismiss), and the sidebar entry only exists in the mobile drawer — so people
 * asking "where do I download the app?" had nowhere to look. This card is
 * permanent and states the situation honestly in every case:
 *   • already installed  → confirmation, no action
 *   • Chrome/Android/desktop with a captured prompt → one-tap install
 *   • iOS Safari → the manual Share → Add to Home Screen steps (iOS gives no
 *     programmatic install, so instructions are the only option)
 *   • anything else (e.g. iOS Chrome) → tells them which browser to open
 */
export default function InstallAppCard({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { canInstall, isStandalone, isIOSSafari, install } = useInstall();

  if (isStandalone) {
    if (compact) return null;
    return (
      <div className="cl-installcard installed">
        <span className="cl-installcard-ic">
          <CheckCircle2 size={18} />
        </span>
        <div className="cl-installcard-body">
          <strong>App installed</strong>
          <span>You&apos;re using the installed Cleano app.</span>
        </div>
      </div>
    );
  }

  const iosSteps = isIOSSafari || /iPad|iPhone|iPod/.test(
    typeof navigator === "undefined" ? "" : navigator.userAgent
  );

  return (
    <div className="cl-installcard">
      <span className="cl-installcard-ic">
        {canInstall ? <Download size={18} /> : iosSteps ? <Share size={18} /> : <Smartphone size={18} />}
      </span>
      <div className="cl-installcard-body">
        <strong>Install the Cleano app</strong>
        {canInstall ? (
          <span>Add Cleano to your device for faster access and notifications.</span>
        ) : iosSteps ? (
          <span>
            In Safari: tap <strong>Share</strong> <Share size={12} style={{ verticalAlign: "-1px" }} /> →{" "}
            <strong>Add to Home Screen</strong>.
          </span>
        ) : (
          <span>
            Open this page in Chrome (Android/desktop) or Safari (iPhone/iPad) to
            add Cleano to your device.
          </span>
        )}
      </div>
      {canInstall && (
        <button
          type="button"
          className="cl-installcard-btn"
          onClick={() => {
            void install();
          }}>
          Install
        </button>
      )}
    </div>
  );
}
