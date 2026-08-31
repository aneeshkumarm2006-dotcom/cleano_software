"use client";

import { useState, useTransition } from "react";

import type { OrgPlan } from "@prisma/client";

import {
  changePlan,
  extendTrial,
  reactivateWorkspace,
  resendOwnerCredentials,
  restartTrial,
  setSeats,
  suspendWorkspace,
  type ActionResult,
  type ApproveResult,
} from "@/lib/console/actions";

/**
 * The parts of a workspace page that change something.
 *
 * Each panel owns one decision and says what will happen before it happens. The
 * pattern is the same throughout: run the action, keep the button disabled while
 * it runs, then show what the server actually reported rather than assuming it
 * worked.
 */

/** "1 customer record", "4 customer records" — never "1 customer records". */
function count(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function Result({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return (
    <div className={r.ok ? "notice good" : "notice bad"} style={{ marginTop: 12 }} role="status">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        {r.ok ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        )}
      </svg>
      <div>{r.message}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PlanPanel({
  orgId,
  plans,
  current,
  cleaners,
  seats,
  seatLimit,
  canEdit,
}: {
  orgId: string;
  plans: { key: OrgPlan; label: string; price: string; cap: string; capNumber: number | null }[];
  current: OrgPlan;
  cleaners: number;
  seats: number | null;
  seatLimit: number | null;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState<OrgPlan>(current);
  const [seatInput, setSeatInput] = useState(seats?.toString() ?? "");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  const target = plans.find((p) => p.key === picked)!;
  const over =
    target.capNumber != null && cleaners > target.capNumber ? cleaners - target.capNumber : 0;

  const consequence =
    picked === current
      ? `Currently on ${target.label}. The seat limit in force is ${seatLimit ?? "unlimited"}.`
      : over > 0
        ? `Moving to ${target.label} would put this workspace ${over} cleaner${over === 1 ? "" : "s"} over its cap. Existing cleaners keep working; no new ones can be added until they are under ${target.capNumber}.`
        : `Moving to ${target.label} takes effect immediately.`;

  return (
    <div className="body">
      <div className="planrow">
        {plans.map((p) => (
          <button
            key={p.key}
            type="button"
            className="planopt"
            aria-pressed={picked === p.key}
            disabled={!canEdit || busy}
            onClick={() => setPicked(p.key)}
          >
            <b>{p.label}</b>
            <span className="price">{p.price}</span>
            <small>{p.cap}</small>
          </button>
        ))}
      </div>

      <p className="sub" style={{ marginTop: 12 }}>
        {consequence}
      </p>

      {canEdit && picked !== current && (
        <button
          type="button"
          className="btn primary"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() =>
            start(async () => {
              const r = await changePlan(orgId, picked);
              setMsg(r);
              if (!r.ok) setPicked(current);
            })
          }
        >
          {busy ? "Changing…" : `Move to ${target.label}`}
        </button>
      )}

      <hr style={{ border: 0, borderTop: "1px solid var(--line-2)", margin: "16px 0" }} />

      <p className="sub" style={{ marginBottom: 10 }}>
        A sold seat count overrides the plan default, so a negotiated deal does not need its own
        plan. Leave it empty to go back to the {target.label} limit.
      </p>
      <div className="formrow">
        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor="seats">Cleaner seats sold</label>
          <input
            id="seats"
            type="number"
            min={1}
            value={seatInput}
            disabled={!canEdit || busy}
            placeholder="Plan default"
            onChange={(e) => setSeatInput(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!canEdit || busy}
          onClick={() =>
            start(async () => {
              const trimmed = seatInput.trim();
              setMsg(await setSeats(orgId, trimmed === "" ? null : Number(trimmed)));
            })
          }
        >
          {busy ? "Saving…" : "Save seats"}
        </button>
      </div>

      <Result r={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function TrialPanel({
  orgId,
  trialing,
  canEdit,
}: {
  orgId: string;
  trialing: boolean;
  canEdit: boolean;
}) {
  const [days, setDays] = useState("7");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="body">
      {trialing ? (
        <>
          <p className="sub" style={{ marginBottom: 10 }}>
            Give this workspace more time without touching its plan. The extension is recorded
            against your name.
          </p>
          <div className="formrow">
            <div className="field" style={{ maxWidth: 120 }}>
              <label htmlFor="days">Extra days</label>
              <input
                id="days"
                type="number"
                min={1}
                max={60}
                value={days}
                disabled={!canEdit || busy}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn"
              disabled={!canEdit || busy}
              onClick={() => start(async () => setMsg(await extendTrial(orgId, Number(days))))}
            >
              {busy ? "Extending…" : "Extend trial"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="sub" style={{ marginBottom: 10 }}>
            This workspace is not on a trial. Restarting gives them a fresh full trial from today —
            use it when a company asks to try again rather than being billed for the gap.
          </p>
          <button
            type="button"
            className="btn"
            disabled={!canEdit || busy}
            onClick={() => start(async () => setMsg(await restartTrial(orgId)))}
          >
            {busy ? "Starting…" : "Start a fresh trial"}
          </button>
        </>
      )}
      <Result r={msg} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AccessPanel({
  orgId,
  name,
  suspended,
  cleaners,
  clients,
  canEdit,
}: {
  orgId: string;
  name: string;
  suspended: boolean;
  cleaners: number;
  clients: number;
  canEdit: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="body">
      <div className="zone-row">
        <div className="txt">
          <b>{suspended ? "Reactivate workspace" : "Suspend workspace"}</b>
          <p>
            {suspended
              ? "Everyone gets access back immediately. Nothing was lost while it was suspended."
              : cleaners > 0
                ? `Locks ${count(cleaners, "cleaner")} and every admin out immediately and shows them a billing notice. Nothing is deleted, and access returns the moment you reactivate.`
                : "Locks every admin out immediately and shows them a billing notice. Nothing is deleted, and access returns the moment you reactivate."}
          </p>
        </div>
        {suspended ? (
          <button
            type="button"
            className="btn primary"
            disabled={!canEdit || busy}
            onClick={() => start(async () => setMsg(await reactivateWorkspace(orgId)))}
          >
            {busy ? "Reactivating…" : "Reactivate"}
          </button>
        ) : (
          <button
            type="button"
            className="btn danger"
            disabled={!canEdit || busy}
            onClick={() => setConfirming((c) => !c)}
          >
            {confirming ? "Cancel" : "Suspend"}
          </button>
        )}
      </div>

      {confirming && !suspended && (
        <div style={{ paddingTop: 12 }}>
          <div className="notice bad" style={{ marginBottom: 12 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>
              <b>{name} will lose access the moment you confirm.</b> Anyone signed in is stopped
              mid-task. {count(clients, "customer record")} stay exactly where they are.
            </div>
          </div>
          <div className="formrow">
            <div className="field">
              <label htmlFor="reason">Reason — shown in the audit log</label>
              <input
                id="reason"
                type="text"
                value={reason}
                disabled={busy}
                placeholder="e.g. payment failed four times, no reply from owner"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn danger"
              disabled={busy || reason.trim().length < 4}
              onClick={() =>
                start(async () => {
                  const r = await suspendWorkspace(orgId, reason);
                  setMsg(r);
                  if (r.ok) {
                    setConfirming(false);
                    setReason("");
                  }
                })
              }
            >
              {busy ? "Suspending…" : `Suspend ${name}`}
            </button>
          </div>
        </div>
      )}

      <div className="zone-row">
        <div className="txt">
          <b>Export everything</b>
          <p>
            One archive with every job, customer, cleaner and photo — what you send an owner when
            they leave. Arrives with the offboarding work in step 7.
          </p>
        </div>
        <button type="button" className="btn" disabled>
          Export
        </button>
      </div>

      <div className="zone-row">
        <div className="txt">
          <b>Delete workspace</b>
          <p>
            Permanent. {count(clients, "customer record")} would be destroyed. Deliberately not
            wired up yet: deletion needs a grace period and a verified export first.
          </p>
        </div>
        <button type="button" className="btn danger" disabled>
          Delete
        </button>
      </div>

      <Result r={msg} />
    </div>
  );
}

/**
 * Give the owner a way back in.
 *
 * A staff-created workspace's first password is shown once and stored only as a
 * hash, and nothing behind it could reissue one: no console reset, a "Forgot
 * password?" that tells an OWNER to contact an administrator they do not have,
 * and no signing in as the customer. A closed browser tab was enough to make a
 * workspace we had just sold permanently unreachable.
 *
 * Behind a confirm, because it INVALIDATES the password they may be using
 * happily right now — this is a rescue, not a button to press while browsing.
 */
export function CredentialsPanel({
  orgId,
  ownerEmail,
  canEdit,
}: {
  orgId: string;
  ownerEmail: string | null;
  canEdit: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<Extract<ApproveResult, { ok: true }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (done) {
    return (
      <div className="body">
        <div className={`notice ${done.emailed ? "good" : "bad"}`} style={{ marginBottom: 12 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d={done.emailed ? "M20 6 9 17l-5-5" : "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"} />
          </svg>
          <div>
            <b>{done.message}</b>
            {!done.emailed && done.emailError && (
              <div style={{ marginTop: 4, fontSize: 12 }}>{done.emailError}</div>
            )}
          </div>
        </div>
        <dl className="kv">
          <dt>Sign in as</dt>
          <dd className="mono">{done.email}</dd>
          <dt>New password</dt>
          <dd className="mono" style={{ wordBreak: "break-all" }}>{done.password}</dd>
        </dl>
        <p className="sub" style={{ marginTop: 10 }}>
          Shown here once as well as emailed, so you can pass it on if the address turns out
          not to work. They must change it the first time they sign in.
        </p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setDone(null)}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="body">
      <div className="zone-row">
        <div className="txt">
          <b>Send a new password</b>
          <p>
            {ownerEmail
              ? `Generates a fresh one-time password, emails it to ${ownerEmail}, and shows it here as well. Their current password stops working.`
              : "This workspace has no owner account to reset."}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!canEdit || busy || !ownerEmail}
          onClick={() => setConfirming((c) => !c)}
        >
          {confirming ? "Cancel" : "Reset"}
        </button>
      </div>

      {confirming && (
        <div style={{ paddingTop: 12 }}>
          <div className="notice bad" style={{ marginBottom: 12 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>
              <b>Their current password stops working immediately.</b> If they are signed in
              right now they stay signed in, but the next sign-in needs the new password.
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() =>
              start(async () => {
                setErr(null);
                const r = await resendOwnerCredentials(orgId);
                if (r.ok) {
                  setDone(r);
                  setConfirming(false);
                } else setErr(r.message);
              })
            }
          >
            {busy ? "Resetting…" : "Reset and email it"}
          </button>
        </div>
      )}

      {err && (
        <div className="notice bad" style={{ marginTop: 12 }} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <div>{err}</div>
        </div>
      )}
    </div>
  );
}
