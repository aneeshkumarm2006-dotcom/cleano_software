"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";

import AdminModal from "@/components/ui/AdminModal";
import type { PlanNotice as Notice } from "@/lib/plan-notice";

const PLAN_URL = "/admin/settings?tab=plan";
/** The popup comes back once a day; the banner stays until they pay. */
const SEEN_KEY = "bookmops.planNotice.seen";

function copyFor(n: Notice): { banner: string; title: string; body: string } {
  switch (n.kind) {
    case "TRIAL_ENDING":
      return {
        banner: `Your free trial ends in ${n.daysLeft} day${n.daysLeft === 1 ? "" : "s"}. Choose a plan to keep going without a gap.`,
        title: "Your trial is ending",
        body: "",
      };
    case "TRIAL_ENDED":
      return {
        banner: "Your free trial has ended. Choose a plan to keep using Bookmops.",
        title: "Your free trial has ended",
        body: "Everything is still here and still working, for you and your crew. Choose a plan to keep it that way.",
      };
    case "PAYMENT_FAILED":
      return {
        banner: "Your last payment didn't go through. Update your card to keep your plan.",
        title: "Your payment didn't go through",
        body: "Nothing has been switched off. Update your card and we'll try the payment again.",
      };
    case "PLAN_ENDED":
      return {
        banner: "Your Bookmops plan has ended. Choose a plan to keep using Bookmops.",
        title: "Your plan has ended",
        body: "Everything is still here and still working. Choose a plan to carry on.",
      };
  }
}

/**
 * The reminder to pay: a banner on every page, and for the serious cases a
 * popup at most once a day. It never blocks anything (lib/plan-notice.ts).
 */
export default function PlanNotice({ notice }: { notice: Notice }) {
  const copy = copyFor(notice);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!notice.popup) return;
    const today = new Date().toDateString();
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      /* private mode: show it, it is only a reminder */
    }
    if (seen !== today) setOpen(true);
  }, [notice.popup]);

  function later() {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toDateString());
    } catch {
      /* nothing to remember it in; it simply comes back next page load */
    }
    setOpen(false);
  }

  return (
    <>
      <div
        role="status"
        className="admin-font"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 16px",
          background: notice.kind === "TRIAL_ENDING" ? "var(--primary-10, #eef6f7)" : "#fff4e5",
          borderBottom: "1px solid var(--line, #e5e7eb)",
          fontSize: 14,
        }}
      >
        <CreditCard size={16} aria-hidden="true" />
        <span style={{ flex: 1, minWidth: 200 }}>{copy.banner}</span>
        <Link href={PLAN_URL} className="btn btn-primary btn-sm">
          {notice.kind === "PAYMENT_FAILED" ? "Update card" : "Choose a plan"}
        </Link>
      </div>

      <AdminModal
        open={open}
        title={copy.title}
        onClose={later}
        footer={
          <>
            <button className="btn btn-secondary btn-sm" onClick={later}>
              Remind me later
            </button>
            <Link href={PLAN_URL} className="btn btn-primary btn-sm" onClick={later}>
              {notice.kind === "PAYMENT_FAILED" ? "Update card" : "Choose a plan"}
            </Link>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>{copy.body}</p>
      </AdminModal>
    </>
  );
}
