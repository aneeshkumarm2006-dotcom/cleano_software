"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";

import { Banner, Button, Field, Input, PasswordInput } from "@/components/customer/Field";

import { checkSlug, createWorkspace, suggestSlug, type SignupResult } from "./actions";

export type PlanCard = {
  key: string;
  label: string;
  price: string;
  per: string;
  cleaners: string;
  highlights: string[];
  /** False for the Organization tier, which is arranged rather than bought. */
  selfServe: boolean;
};

type SlugCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "free"; slug: string }
  | { state: "taken"; reason: string };

export default function SignupForm({
  plans,
  trialDays,
  initialPlan,
}: {
  plans: PlanCard[];
  trialDays: number;
  initialPlan: string;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [check, setCheck] = useState<SlugCheck>({ state: "idle" });
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Extract<SignupResult, { ok: true }> | null>(null);

  // Suggest an address from the company name, but stop the moment the visitor
  // edits the address themselves — overwriting what someone typed is the fastest
  // way to make a form feel broken.
  useEffect(() => {
    if (slugTouched || company.trim().length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      const s = await suggestSlug(company);
      if (live) setSlug(s);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [company, slugTouched]);

  // Availability, debounced. `seq` drops a slow answer that arrives after a
  // newer one, which would otherwise show the wrong verdict for the typed text.
  const seq = useRef(0);
  useEffect(() => {
    if (slug.trim().length < 3) {
      setCheck({ state: "idle" });
      return;
    }
    const mine = ++seq.current;
    setCheck({ state: "checking" });
    const t = setTimeout(async () => {
      const r = await checkSlug(slug);
      if (mine !== seq.current) return;
      setCheck(r.ok ? { state: "free", slug: r.slug } : { state: "taken", reason: r.reason });
    }, 350);
    return () => clearTimeout(t);
  }, [slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await createWorkspace({
        companyName: company,
        slug,
        ownerName: name,
        ownerEmail: email,
        password,
        plan,
      });
      if (r.ok) setDone(r);
      else setError({ field: r.field, message: r.message });
    } catch {
      setError({ field: "form", message: "Unexpected error. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const ends = new Date(done.trialEndsAt).toLocaleDateString("en-CA", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return (
      <>
        <header style={{ marginBottom: 28 }}>
          <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
            All set
          </p>
          <h1 className="cl-display">
            Your workspace
            <br />
            is <em>ready.</em>
          </h1>
          <p className="cl-subtitle">
            {done.slug} is yours. Your {trialDays}-day trial runs until {ends} — no card needed
            until then.
          </p>
        </header>

        <div className="cl-stack-20">
          <Banner kind="success">
            Sign in at <b>{done.slug}</b> with <b>{done.email}</b>. That address is where your
            company works from now on — bookmark it.
          </Banner>

          {done.url ? (
            <a href={`${done.url}/sign-in?welcome=1&email=${encodeURIComponent(done.email)}`}>
              <Button variant="primary" block size="lg" type="button">
                Open my workspace
              </Button>
            </a>
          ) : (
            <p className="cl-subtitle">
              Open <b>{done.slug}</b> and sign in with {done.email}.
            </p>
          )}
        </div>
      </>
    );
  }

  const chosen = plans.find((p) => p.key === plan);
  const selfServe = chosen?.selfServe ?? false;
  const slugOk = check.state === "free";
  const canSubmit =
    !busy &&
    selfServe &&
    company.trim().length >= 2 &&
    name.trim().length >= 2 &&
    email.includes("@") &&
    password.length >= 10 &&
    slugOk;

  return (
    <>
      <header style={{ marginBottom: 32 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          {trialDays} days free · no card
        </p>
        <h1 className="cl-display">
          Start running
          <br />
          your <em>cleaning company.</em>
        </h1>
        <p className="cl-subtitle">
          Scheduling, your crew, customers and invoicing — in one place, at your own address.
        </p>
      </header>

      <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
        <Field label="Choose a plan" error={error?.field === "plan" ? error.message : undefined}>
          <div style={{ display: "grid", gap: 10 }}>
            {plans.map((p) => {
              const active = p.key === plan;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPlan(p.key)}
                  aria-pressed={active}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "14px 16px",
                    borderRadius: 12,
                    font: "inherit",
                    color: "inherit",
                    background: active ? "var(--primary-5, #f4f7fb)" : "transparent",
                    border: `1.5px solid ${active ? "var(--primary-deep, #19356D)" : "var(--border, #dfe3ea)"}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <b style={{ fontSize: 15 }}>{p.label}</b>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{p.price}</span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{p.per}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
                      {p.cleaners}
                    </span>
                  </div>
                  {active && (
                    <ul
                      style={{
                        margin: "10px 0 0",
                        padding: 0,
                        listStyle: "none",
                        display: "grid",
                        gap: 5,
                        fontSize: 13,
                      }}
                    >
                      {p.highlights.map((h) => (
                        <li key={h} style={{ display: "flex", gap: 7, alignItems: "center" }}>
                          <Check size={14} aria-hidden />
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="Company name"
          htmlFor="su-company"
          error={error?.field === "company" ? error.message : undefined}
        >
          <Input
            id="su-company"
            value={company}
            autoComplete="organization"
            placeholder="Sparkle Clean"
            onChange={(e) => {
              setCompany(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Your address on Awer"
          htmlFor="su-slug"
          error={
            error?.field === "slug"
              ? error.message
              : check.state === "taken"
                ? check.reason
                : undefined
          }
          hint={
            check.state === "checking"
              ? "Checking…"
              : check.state === "free"
                ? `${check.slug}.useawer.com is free`
                : "This is where you and your team will sign in every day."
          }
        >
          <Input
            id="su-slug"
            value={slug}
            error={check.state === "taken"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sparkle-clean"
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Your name"
          htmlFor="su-name"
          error={error?.field === "name" ? error.message : undefined}
        >
          <Input
            id="su-name"
            value={name}
            autoComplete="name"
            placeholder="Dana Fortin"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Work email"
          htmlFor="su-email"
          error={error?.field === "email" ? error.message : undefined}
        >
          <Input
            id="su-email"
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@yourcompany.com"
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="su-password"
          error={error?.field === "password" ? error.message : undefined}
          hint="At least 10 characters. This account owns the whole workspace."
        >
          <PasswordInput
            id="su-password"
            value={password}
            autoComplete="new-password"
            placeholder="••••••••••"
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
        </Field>

        {error?.field === "form" && <Banner kind="error">{error.message}</Banner>}

        {!selfServe && (
          <Banner kind="amber">
            {chosen?.label} is arranged with us rather than signed up for, because it is priced per
            company. The request form is the next thing being built — until then, pick a plan above
            to start today and we can move you across later without losing anything.
          </Banner>
        )}

        <Button type="submit" variant="primary" block size="lg" disabled={!canSubmit} loading={busy}>
          {busy ? "Creating your workspace…" : `Start my ${trialDays} days`}
        </Button>

        <p className="cl-subtitle" style={{ fontSize: 12 }}>
          No card needed to start, and nothing is charged when the trial ends — you choose then.
          Already have a workspace? Sign in at your own address.
        </p>
      </form>
    </>
  );
}
