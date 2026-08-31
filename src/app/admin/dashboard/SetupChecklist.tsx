import Link from "next/link";
import { Check, ChevronRight, AlertTriangle } from "lucide-react";

import type { SetupStep } from "@/lib/setup-checklist.server";

/**
 * The setup card a new workspace lands on, and an established one never sees.
 *
 * Rendered only while something is genuinely outstanding — the dashboard drops
 * it entirely once every step reports done, so this is not a banner anybody has
 * to dismiss. Completed steps stay listed, greyed: seeing what is already
 * handled is what makes the remaining count mean anything.
 */
export default function SetupChecklist({
  steps,
  firstName,
}: {
  steps: SetupStep[];
  firstName: string;
}) {
  const done = steps.filter((s) => s.done).length;
  const blocking = steps.filter((s) => s.blocking && !s.done);
  /**
   * "Finish setting up" is the right thing to say to a workspace opened this
   * morning and the wrong thing to say to a business that has been trading for
   * years and has simply never opened one settings tab. Near the end, the card
   * stops calling itself onboarding and just names what is left.
   */
  const nearlyThere = done >= steps.length - 2;

  return (
    <div className="dash-setup" style={{ marginBottom: 32 }}>
      <div className="dash-setup-head">
        <div>
          <h2 className="dash-setup-title">
            {nearlyThere
              ? `A couple of things left, ${firstName}`
              : `Finish setting up, ${firstName}`}
          </h2>
          <p className="dash-setup-sub">
            {blocking.length > 0 ? (
              <>
                <strong>{blocking[0].label}</strong> is the one that stops
                customers booking. The rest change what they are quoted.
              </>
            ) : (
              <>
                Everything below has a working default, so nothing is broken —
                but the defaults were set for another company.
              </>
            )}
          </p>
        </div>
        <div className="dash-setup-count">
          <span className="dash-setup-count-num">
            {done}
            <span className="dash-setup-count-of">/{steps.length}</span>
          </span>
          <span className="dash-setup-count-label">done</span>
        </div>
      </div>

      <div className="dash-setup-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <ol className="dash-setup-list">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              href={s.href}
              className={`dash-setup-row${s.done ? " is-done" : ""}${
                s.blocking && !s.done ? " is-blocking" : ""
              }`}
            >
              <span className="dash-setup-mark" aria-hidden="true">
                {s.done ? <Check size={13} strokeWidth={3} /> : null}
              </span>
              <span className="dash-setup-body">
                <span className="dash-setup-label">
                  {s.label}
                  <span className="dash-setup-state">{s.state}</span>
                  {s.blocking && !s.done && (
                    <span className="dash-setup-flag">
                      <AlertTriangle size={11} strokeWidth={2.5} />
                      Blocks bookings
                    </span>
                  )}
                </span>
                {!s.done && <span className="dash-setup-why">{s.why}</span>}
                {s.note && <span className="dash-setup-note">{s.note}</span>}
              </span>
              <span className="dash-setup-arrow">
                <ChevronRight size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
