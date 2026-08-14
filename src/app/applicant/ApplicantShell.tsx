"use client";

import { LogOut, Sparkles } from "lucide-react";

interface ApplicantShellProps {
  user: { name: string; email: string };
  signOutAction: () => void | Promise<void>;
  children: React.ReactNode;
}

// Minimal portal chrome — the applicant portal is a single page (MVP scope,
// decision D4), so unlike PortalShell (customer) / CleanerSidebar there is no
// multi-item nav to build, just a header and a sign-out affordance. Reuses
// the shared cl-customer / cl-portal-topbar classes for visual consistency
// with the customer and cleaner login pages.
export default function ApplicantShell({
  user,
  signOutAction,
  children,
}: ApplicantShellProps) {
  const firstName = user.name.split(/\s+/)[0] || user.name;

  return (
    <div className="cl-customer">
      <header
        className="cl-portal-topbar"
        style={{ position: "sticky", top: 0, zIndex: 10 }}>
        <span
          className="cl-logo-mark"
          style={{
            background: "var(--primary)",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: 8,
          }}>
          <Sparkles size={16} strokeWidth={1.8} />
        </span>
        <span className="cl-portal-topbar-title" style={{ marginLeft: 8 }}>
          cleano
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginRight: 12,
            color: "var(--primary)",
          }}>
          Hi, {firstName}
        </span>
        <form action={signOutAction}>
          <button
            type="submit"
            aria-label="Sign out"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--primary)",
              background: "transparent",
              border: "1px solid var(--primary-20, #cfe3e0)",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
            }}>
            <LogOut size={14} />
            Sign out
          </button>
        </form>
      </header>
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 80px" }}>
        {children}
      </main>
    </div>
  );
}
