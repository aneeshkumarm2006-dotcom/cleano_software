"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { openPortal, startCheckout } from "../../actions/billing";

export interface PlanOption {
  key: string;
  label: string;
  monthlyUsd: number | null;
  annualUsd: number | null;
  /** Annual price expressed per month, for the "billed yearly" line. */
  annualPerMonth: number | null;
  highlights: string[];
  selfServe: boolean;
}

export interface PlanStatus {
  plan: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  interval: "MONTHLY" | "ANNUAL";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A Stripe subscription exists, so there is a card and a billing page. */
  paying: boolean;
  cleanersUsed: number;
  cleanerLimit: number | null;
  monthsSaved: number;
}

interface Props {
  plans: PlanOption[];
  status: PlanStatus;
}

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

/**
 * The one line at the top that says where this workspace stands. Written so
 * the sentence itself carries the urgency, rather than a colour doing it.
 */
function StateBanner({ status }: { status: PlanStatus }) {
  const trialDays = daysUntil(status.trialEndsAt);

  let tone: "calm" | "warn" | "bad" = "calm";
  let text: string;

  if (status.status === "PAST_DUE") {
    tone = "bad";
    text = "A payment failed. Update your card to keep the workspace running.";
  } else if (status.status === "CANCELED") {
    tone = "bad";
    text = "This subscription has ended. Choose a plan below to start again.";
  } else if (status.cancelAtPeriodEnd && status.currentPeriodEnd) {
    tone = "warn";
    text = `Cancelled. You keep everything until ${longDate(status.currentPeriodEnd)}.`;
  } else if (status.status === "TRIALING") {
    tone = trialDays != null && trialDays <= 7 ? "warn" : "calm";
    text =
      trialDays == null
        ? "You are on a free trial."
        : trialDays === 0
          ? "Your free trial ends today. Add a card to keep going."
          : `${trialDays} day${trialDays === 1 ? "" : "s"} left on your free trial.`;
  } else if (status.currentPeriodEnd) {
    text = `Your plan renews on ${longDate(status.currentPeriodEnd)}.`;
  } else {
    text = "Your plan is active.";
  }

  const cls =
    tone === "bad"
      ? "bg-red-50 text-red-800 ring-red-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-900 ring-amber-200"
        : "bg-[#008C9C]/8 text-[#00707d] ring-[#008C9C]/20";

  return (
    <div className={`rounded-xl px-4 py-3 text-sm font-medium ring-1 ring-inset ${cls}`} role="status">
      {text}
    </div>
  );
}

export default function PlanTab({ plans, status }: Props) {
  const [interval, setInterval] = useState<"MONTHLY" | "ANNUAL">(status.interval);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const go = (fn: () => Promise<{ ok: boolean; url?: string; message?: string }>) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.ok && r.url) window.location.href = r.url;
      else setMsg(r.message ?? "Something went wrong.");
    });

  const overCap =
    status.cleanerLimit != null && status.cleanersUsed > status.cleanerLimit;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Your Awer plan</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              What this workspace pays Awer. Separate from the payments you take from your own
              customers, which are set up under Payments.
            </p>
          </div>
          <StateBanner status={status} />

          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-gray-500">Plan</dt>
              <dd className="font-medium text-gray-900">
                {plans.find((p) => p.key === status.plan)?.label ?? status.plan}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Billing</dt>
              <dd className="font-medium text-gray-900">
                {status.paying
                  ? status.interval === "ANNUAL"
                    ? "Yearly"
                    : "Monthly"
                  : "No card on file"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Cleaners</dt>
              <dd className={`font-medium tabular-nums ${overCap ? "text-red-700" : "text-gray-900"}`}>
                {status.cleanersUsed}
                {status.cleanerLimit == null ? " (no limit)" : ` of ${status.cleanerLimit}`}
              </dd>
            </div>
          </dl>
          {overCap && (
            <p className="text-sm text-red-700">
              You have more cleaners than this plan allows. Move up a plan to add any more.
            </p>
          )}
        </div>

        {/* interval toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-gray-50/70 border-b border-gray-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Choose a plan
          </div>
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5">
            {(["MONTHLY", "ANNUAL"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInterval(i)}
                aria-pressed={interval === i}
                className={`rounded-[10px] px-3 py-1.5 text-sm font-semibold transition ${
                  interval === i ? "bg-[#008C9C] text-white" : "text-gray-600 hover:bg-gray-50"
                }`}>
                {i === "MONTHLY" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const current = p.key === status.plan && status.paying;
            const price = interval === "ANNUAL" ? p.annualUsd : p.monthlyUsd;
            return (
              <div
                key={p.key}
                className={`flex flex-col rounded-xl border p-4 ${
                  current ? "border-[#008C9C] ring-1 ring-[#008C9C]/20" : "border-gray-200"
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900">{p.label}</div>
                  {current && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#008C9C]/10 px-2 py-0.5 text-[11px] font-semibold text-[#00707d]">
                      <Check size={11} strokeWidth={3} />
                      Current
                    </span>
                  )}
                </div>

                <div className="mt-2 mb-3">
                  {price == null ? (
                    <div className="text-lg font-semibold text-gray-900">Talk to us</div>
                  ) : (
                    <>
                      <div className="text-2xl font-semibold text-gray-900 tabular-nums">
                        {money(price)}
                        <span className="text-sm font-normal text-gray-500">
                          {interval === "ANNUAL" ? "/year" : "/month"}
                        </span>
                      </div>
                      {interval === "ANNUAL" && p.annualPerMonth != null && (
                        <div className="text-xs text-gray-500 mt-0.5 tabular-nums">
                          {money(p.annualPerMonth)}/month, billed yearly
                          {status.monthsSaved > 0 &&
                            ` · ${status.monthsSaved} month${status.monthsSaved === 1 ? "" : "s"} free`}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <ul className="space-y-1.5 text-sm text-gray-600 flex-1">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-[#008C9C]" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  {!p.selfServe ? (
                    <a
                      href="mailto:hello@useawer.com?subject=Organization%20plan"
                      className="block rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-gray-700 transition hover:bg-gray-50">
                      Contact us
                    </a>
                  ) : current ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => go(openPortal)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40">
                      Manage billing
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        // Switching an active subscription charges the
                        // difference straight away. A card already on file
                        // means one click would otherwise move real money
                        // with nothing said first.
                        if (
                          status.paying &&
                          !window.confirm(
                            `Switch to ${p.label}${interval === "ANNUAL" ? ", billed yearly" : ""}? Stripe works out the difference for the rest of this period and charges or credits it.`,
                          )
                        ) {
                          return;
                        }
                        go(() => startCheckout({ plan: p.key, interval }));
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#008C9C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00707d] disabled:opacity-40">
                      {busy && <Loader2 size={15} className="animate-spin" />}
                      {status.paying ? "Switch to this plan" : "Choose this plan"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {status.paying && (
          <div className="border-t border-gray-100 bg-gray-50/70 px-5 py-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => go(openPortal)}
              className="text-sm font-semibold text-[#00707d] transition hover:underline disabled:opacity-40">
              Change your card, see invoices, or cancel
            </button>
          </div>
        )}

        {msg && (
          <div className="px-5 pb-5">
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {msg}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
