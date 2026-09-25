"use client";

import { useState, useTransition } from "react";

import { createWorkspace, type ApproveResult } from "@/lib/console/actions";
import { PLANS } from "@/lib/plans";

/**
 * Creating a workspace for a company that never filled anything in.
 *
 * The other two routes both begin with the customer — they sign themselves up
 * at /get-started, or they ask for the Organization tier and someone approves
 * it in the requests queue. This is the third: a company won over the phone,
 * where the first thing they should see is a workspace that already exists.
 *
 * Modelled on RequestCard on purpose. The two flows create the same thing by
 * the same means, so they show the same confirmation and hand back the same
 * one-time password; making them look different would suggest they differ.
 */

const PLAN_ORDER = ["STARTER", "PROFESSIONAL", "ORGANIZATION"] as const;

/**
 * The address suggested while typing.
 *
 * A second copy of the rule in provisioning.ts, and knowingly so: that module
 * reaches the database on import and cannot come to the browser. The server
 * slugifies again and its answer is the one that counts, so a drift here shows
 * up as a suggestion that is politely corrected, never as a wrong address.
 */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
}

export default function NewWorkspace({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  // Until the address is edited by hand it follows the company name. After
  // that it stops, because overwriting something someone typed is worse than
  // leaving a suggestion behind.
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [plan, setPlan] = useState<string>("PROFESSIONAL");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Extract<ApproveResult, { ok: true }> | null>(null);
  const [busy, start] = useTransition();

  const effectiveSlug = slugTouched ? slug : suggestSlug(company);
  const ready =
    company.trim().length >= 2 &&
    ownerName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim()) &&
    effectiveSlug.length >= 3;

  function reset() {
    setCompany("");
    setSlug("");
    setSlugTouched(false);
    setOwnerName("");
    setOwnerEmail("");
    setPlan("PROFESSIONAL");
    setTimezone("");
    setError(null);
    setCreated(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn primary"
        disabled={!canEdit}
        title={canEdit ? undefined : "Creating a workspace takes an admin."}
        onClick={() => setOpen(true)}
      >
        New workspace
      </button>
    );
  }

  // A full-width child of .pagehead, which wraps, so the form gets its own row
  // under the heading rather than squeezing the title.
  const panel: React.CSSProperties = { flexBasis: "100%", width: "100%" };

  if (created) {
    return (
      <div className="card" style={panel}>
        <header>Workspace created</header>
        <div style={{ padding: 14 }}>
          <div className="notice good" style={{ marginBottom: 12 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <div>
              <b>{created.message}</b>
            </div>
          </div>
          <dl className="kv">
            <dt>Address</dt>
            <dd className="mono">{created.slug}.useawer.com</dd>
            <dt>Sign in as</dt>
            <dd className="mono">{created.email}</dd>
            <dt>First password</dt>
            <dd className="mono" style={{ wordBreak: "break-all" }}>
              {created.password}
            </dd>
          </dl>
          {created.emailed ? (
            <p className="sub" style={{ marginTop: 10 }}>
              These have been emailed to <span className="mono">{created.email}</span>. Kept on
              screen too, so you can pass them on if that address turns out not to reach them.
              The password is stored only as a hash and they must change it on first sign-in.
            </p>
          ) : (
            <div className="notice bad" style={{ marginTop: 12 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
              <div>
                <b>The email did not go out — copy this password now.</b> It is shown once and
                stored only as a hash. You can always issue a new one from the workspace page.
                {created.emailError && (
                  <div style={{ marginTop: 4, fontSize: 12 }}>{created.emailError}</div>
                )}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
            <button type="button" className="btn" onClick={reset}>
              Create another
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={panel}>
      <header>New workspace</header>
      <div style={{ padding: 14 }}>
        <p className="sub" style={{ marginBottom: 12 }}>
          This creates a live workspace immediately, with a 30-day trial and the person below as
          its owner. Use it for a company you have already spoken to — anyone can sign themselves
          up at <span className="mono">useawer.com/get-started</span>.
        </p>

        <div className="formrow" style={{ marginBottom: 10 }}>
          <div className="field">
            <label htmlFor="nw-company">Company name</label>
            <input
              id="nw-company"
              type="text"
              value={company}
              disabled={busy}
              placeholder="CleanoCalgary"
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="nw-slug">Address</label>
            <input
              id="nw-slug"
              type="text"
              value={effectiveSlug}
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </div>
        </div>

        <div className="formrow" style={{ marginBottom: 10 }}>
          <div className="field">
            <label htmlFor="nw-owner">Owner&rsquo;s name</label>
            <input
              id="nw-owner"
              type="text"
              value={ownerName}
              disabled={busy}
              placeholder="The person who runs it"
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="nw-email">Owner&rsquo;s email</label>
            <input
              id="nw-email"
              type="text"
              value={ownerEmail}
              disabled={busy}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="they@theircompany.com"
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="formrow">
          <div className="field">
            <label htmlFor="nw-plan">Plan</label>
            <select
              id="nw-plan"
              value={plan}
              disabled={busy}
              onChange={(e) => setPlan(e.target.value)}
            >
              {PLAN_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PLANS[p].label}
                  {PLANS[p].monthlyUsd == null ? " · quoted" : ` · $${PLANS[p].monthlyUsd}/mo`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nw-tz">Time zone</label>
            <input
              id="nw-tz"
              type="text"
              value={timezone}
              disabled={busy}
              placeholder="America/Toronto"
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !ready}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await createWorkspace({
                  companyName: company,
                  slug: effectiveSlug,
                  ownerName,
                  ownerEmail,
                  plan,
                  timezone,
                });
                if (r.ok) setCreated(r);
                else setError(r.message);
              })
            }
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </button>
        </div>

        <p className="sub" style={{ marginTop: 8 }}>
          Will be <span className="mono">{effectiveSlug || "…"}.useawer.com</span>. A one-time
          password is generated and shown here once; they must change it on first sign-in.
        </p>

        {error && (
          <div className="notice bad" style={{ marginTop: 12 }} role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
            <div>{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
