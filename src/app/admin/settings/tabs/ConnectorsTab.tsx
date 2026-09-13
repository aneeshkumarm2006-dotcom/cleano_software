"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Loader2, Trash2, X } from "lucide-react";
import {
  claimTwilioNumber,
  connectTwilio,
  setSmsForwardUrl,
  disconnectTwilio,
  listTwilioNumbers,
  testTwilio,
  type TwilioNumber,
  type TwilioTest,
} from "../../actions/twilioConnection";
import {
  addProxyNumber,
  listProxyNumbers,
  removeProxyNumber,
  setProxyNumberActive,
  type ProxyNumberRow,
} from "../../actions/proxyNumbers";
import { themedInputClass } from "./_shared";

export interface TwilioStatus {
  connected: boolean;
  accountSid: string | null;
  tokenHint: string | null;
  connectedAt: string | null;
  unreadable: boolean;
  usingPlatform: boolean;
  smsNumber: string | null;
  /** Second system that also receives incoming texts. Empty means none. */
  forwardUrl: string;
  /**
   * Whether this deployment has a SECRETS_KEY and can therefore store an auth
   * token. False means connecting is impossible, and the card has to say so
   * BEFORE the token field — the same treatment the Stripe card gives it.
   */
  canStoreSecrets: boolean;
}

interface Props {
  twilio: TwilioStatus;
  /** Where this workspace's Twilio webhook should point. */
  webhookUrl: string;
  /** The same address for calls — one pooled number needs both. */
  voiceWebhookUrl: string;
  /** The masked-number pool, read server-side so the counts are current. */
  proxyNumbers: ProxyNumberRow[];
}

/**
 * Twilio's brand mark, drawn rather than fetched: the connectors page must
 * render identically offline and behind a CSP, and a logo that sometimes fails
 * to load is worse than no logo. If Twilio refreshes the mark, this is the only
 * place to change.
 */
function TwilioMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#F22F46" />
      <g fill="#fff">
        <circle cx="18" cy="18" r="5.2" />
        <circle cx="30" cy="30" r="5.2" />
        <circle cx="30" cy="18" r="2.6" />
        <circle cx="18" cy="30" r="2.6" />
      </g>
    </svg>
  );
}

/** Connected / falling back / broken — colour and words agree, always. */
function StatusPill({ twilio }: { twilio: TwilioStatus }) {
  const s = twilio.unreadable
    ? { dot: "bg-red-500", cls: "bg-red-50 text-red-700 ring-red-200", label: "Needs reconnecting" }
    : twilio.connected
      ? { dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Connected" }
      : twilio.usingPlatform
        ? { dot: "bg-[#008C9C]", cls: "bg-[#008C9C]/8 text-[#00707d] ring-[#008C9C]/20", label: "Using Awer's account" }
        : { dot: "bg-gray-400", cls: "bg-gray-100 text-gray-600 ring-gray-200", label: "Not set up" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/**
 * One address to paste into Twilio, with the tab's copy affordance.
 *
 * There are three of them now — incoming texts, and both legs of a pooled
 * number — and they all copy the same way, so the button lives here once.
 */
function WebhookAddress({
  url,
  copied,
  onCopy,
}: {
  url: string;
  copied: boolean;
  onCopy: (url: string) => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] font-mono text-gray-800 break-all">
        {url}
      </code>
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function ConnectorsTab({
  twilio,
  webhookUrl,
  voiceWebhookUrl,
  proxyNumbers,
}: Props) {
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<TwilioTest | null>(null);
  const [numbers, setNumbers] = useState<TwilioNumber[] | null>(null);
  const [forward, setForward] = useState(twilio.forwardUrl);
  // Which address was copied, not whether one was: there are three of them on
  // this tab now and a shared boolean ticks all three at once.
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, start] = useTransition();

  // The pool, held locally so an add or a removal shows immediately —
  // `revalidatePath` only marks the route dirty and the repaint lands long
  // after the click. The server payload takes over whenever a new one arrives.
  const [pool, setPool] = useState<ProxyNumberRow[]>(proxyNumbers);
  const [newNumber, setNewNumber] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [poolMsg, setPoolMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [poolBusy, startPool] = useTransition();
  useEffect(() => {
    setPool(proxyNumbers);
  }, [proxyNumbers]);
  const activePool = pool.filter((n) => n.isActive).length;

  /** Run a pool mutation, then re-read the list so the live counts are true. */
  function runPool(fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) {
    startPool(async () => {
      const r = await fn();
      if (!r.ok) {
        setPoolMsg({ ok: false, text: r.message ?? "That did not work." });
        return;
      }
      setPoolMsg(null);
      done?.();
      const list = await listProxyNumbers();
      if (list.ok) setPool(list.numbers);
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      setTest(null);
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setSid("");
        setToken("");
      }
    });

  function loadNumbers() {
    start(async () => {
      setTest(null);
      const r = await listTwilioNumbers();
      if (r.ok) setNumbers(r.numbers);
      else {
        setNumbers(null);
        setMsg({ ok: false, text: r.message });
      }
    });
  }

  // A connected workspace with no number yet has exactly one thing to do on
  // this page, so it should not have to press a button to discover what its
  // options are. Once a number is set the list is opt-in, because reading it
  // costs a Twilio call on every visit.
  useEffect(() => {
    if (twilio.connected && !twilio.smsNumber) loadNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twilio.connected, twilio.smsNumber]);

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  }

  /**
   * Will pressing Connect actually reach Twilio?
   *
   * `busy` is one pending flag for the whole server action, and connectTwilio
   * returns before any network call three times over: the owner/admin guard,
   * the SECRETS_KEY guard, and the SID/token shape checks. Labelling all of
   * that "Checking with Twilio…" claims a round-trip that never happened, and
   * a user reading it believes Twilio rejected credentials it never saw.
   *
   * So mirror only the last gate here — the first two are already settled by
   * the time the button is pressable (this page is owner/admin only, and the
   * button is disabled without a SECRETS_KEY). connectTwilio stays the
   * authority and repeats these checks server-side; this copy decides wording,
   * never whether the value is accepted, so drifting slightly costs a label.
   */
  const reachesTwilio = /^AC[0-9a-fA-F]{32}$/.test(sid.trim()) && token.trim().length >= 20;


  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* header */}
        <div className="flex items-start gap-4 p-5 border-b border-gray-100">
          <TwilioMark className="h-11 w-11 shrink-0 rounded-xl shadow-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-[15px] font-semibold text-gray-900">Texting</h3>
              <StatusPill twilio={twilio} />
            </div>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Where your text messages come from and go to. Connect your own Twilio account to keep
              your numbers, your bill and your sender registration — or leave this alone and texts
              run on Awer&apos;s account.
            </p>
          </div>
        </div>

        {/* current state */}
        <div className="px-5 py-4 bg-gray-50/70 border-b border-gray-100">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 text-sm">
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-gray-500">Account</dt>
              <dd className="font-medium text-gray-900 tabular-nums truncate">
                {twilio.unreadable
                  ? "Saved credentials can no longer be read"
                  : twilio.connected
                    ? twilio.accountSid
                    : twilio.usingPlatform
                      ? "Awer's shared account"
                      : "None available"}
              </dd>
            </div>
            <div className="flex justify-between gap-4 sm:block">
              <dt className="text-gray-500">Your number</dt>
              <dd className="font-medium text-gray-900 tabular-nums">
                {twilio.smsNumber ?? "Not assigned yet"}
              </dd>
            </div>
            {twilio.connected && (
              <>
                <div className="flex justify-between gap-4 sm:block">
                  <dt className="text-gray-500">Auth token</dt>
                  <dd className="font-medium text-gray-900">{twilio.tokenHint}</dd>
                </div>
                <div className="flex justify-between gap-4 sm:block">
                  <dt className="text-gray-500">Connected</dt>
                  <dd className="font-medium text-gray-900">
                    {twilio.connectedAt
                      ? new Date(twilio.connectedAt).toLocaleDateString("en-CA", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {twilio.unreadable && (
            <p className="text-sm text-red-700 mt-3">
              Texting has stopped for this workspace. Enter the credentials again below to restore
              it.
            </p>
          )}
          {!twilio.smsNumber && !twilio.connected && (
            <p className="text-sm text-gray-500 mt-3">
              On Awer&apos;s shared account a number is assigned by support. Connect your own Twilio
              account below and you can choose one yourself.
            </p>
          )}
        </div>

        {/* connect / disconnect */}
        <div className="p-5 space-y-4">
          {twilio.connected && (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50/70 px-4 py-2.5">
                <div className="text-sm font-semibold text-gray-900">
                  {twilio.smsNumber ? "Change your texting number" : "Choose your texting number"}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={loadNumbers}
                  className="text-sm font-semibold text-[#00707d] transition hover:underline disabled:opacity-40">
                  {busy ? "Loading…" : numbers ? "Refresh" : "Show my Twilio numbers"}
                </button>
              </div>
              {numbers === null ? (
                <p className="px-4 py-3 text-sm text-gray-500">
                  These come straight from the Twilio account you connected, so you can pick one
                  here rather than asking support.
                </p>
              ) : numbers.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-600">
                  That Twilio account has no phone numbers yet. Buy one in Twilio, then refresh.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {numbers.map((n) => {
                    const current = n.phoneNumber === twilio.smsNumber;
                    return (
                      <li
                        key={n.phoneNumber}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-900 tabular-nums">
                            {n.phoneNumber}
                          </div>
                          <div className="truncate text-xs text-gray-500">
                            {!n.sms
                              ? "Voice only — this number cannot receive texts"
                              : n.taken
                                ? "Already the texting number of another Awer workspace"
                                : n.messagingServiceSid
                                  ? `Sends through "${n.messagingServiceName ?? n.messagingServiceSid}"`
                                  : n.label}
                          </div>
                        </div>
                        {current ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            <Check size={12} strokeWidth={3} />
                            In use
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy || !n.sms || n.taken}
                            onClick={() =>
                              run(() => claimTwilioNumber({ phoneNumber: n.phoneNumber }))
                            }
                            className="shrink-0 rounded-lg border border-[#008C9C]/25 bg-[#008C9C]/5 px-3 py-1.5 text-xs font-semibold text-[#00707d] transition hover:bg-[#008C9C]/10 disabled:opacity-40 disabled:cursor-not-allowed">
                            Use this number
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/*
            Said before the token field, never after it. connectTwilio refuses
            without a SECRETS_KEY, and an auth token typed into a form that was
            never going to store it is a live credential that now has to be
            rotated. Same warning, same wording, as the Stripe card.
          */}
          {!twilio.connected && !twilio.canStoreSecrets && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This deployment has no SECRETS_KEY set, so credentials cannot be stored securely and
              saving is disabled. Your administrator can generate one with{" "}
              <code>openssl rand -hex 32</code>.
            </p>
          )}

          {!twilio.connected && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="twilio-sid"
                  className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Account SID
                </label>
                <input
                  id="twilio-sid"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className={`${themedInputClass} font-mono`}
                  value={sid}
                  onChange={(e) => setSid(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="twilio-token"
                  className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  Auth token
                </label>
                <input
                  id="twilio-token"
                  type="password"
                  autoComplete="off"
                  placeholder="Kept encrypted, never shown again"
                  className={`${themedInputClass} font-mono`}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {!twilio.connected ? (
              <button
                type="button"
                disabled={busy || !sid.trim() || !token.trim() || !twilio.canStoreSecrets}
                onClick={() => run(() => connectTwilio({ accountSid: sid, authToken: token }))}
                className="inline-flex items-center gap-2 rounded-xl bg-[#008C9C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00707d] disabled:opacity-40 disabled:cursor-not-allowed">
                {busy && <Loader2 size={15} className="animate-spin" />}
                {busy ? (reachesTwilio ? "Checking with Twilio…" : "Checking…") : "Connect Twilio"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(disconnectTwilio)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40">
                Disconnect
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  setMsg(null);
                  setTest(await testTwilio());
                })
              }
              className="inline-flex items-center gap-2 rounded-xl border border-[#008C9C]/25 bg-[#008C9C]/5 px-4 py-2.5 text-sm font-semibold text-[#00707d] transition hover:bg-[#008C9C]/10 disabled:opacity-40">
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? "Testing…" : "Test connection"}
            </button>
          </div>

          {msg && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ${
                msg.ok ? "bg-[#008C9C]/8 text-[#00707d]" : "bg-red-50 text-red-700"
              }`}
              role="status">
              {msg.text}
            </div>
          )}

          {test && (
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div
                className={`px-4 py-2.5 text-sm font-semibold ${
                  test.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
                }`}>
                {test.ok
                  ? "Everything checks out — texts will send and arrive."
                  : "Something needs fixing before texts will work."}
              </div>
              <div className="divide-y divide-gray-100">
                {test.checks.map((c) => (
                  <div key={c.label} className="flex gap-3 px-4 py-3 text-sm">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        c.pass ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}>
                      {c.pass ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{c.label}</div>
                      <div className="text-gray-600">{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* keep a second system fed during a migration */}
        <div className="border-t border-gray-100 p-5">
          <label
            htmlFor="twilio-forward"
            className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Also send incoming texts to
          </label>
          <div className="flex flex-wrap items-stretch gap-2">
            <input
              id="twilio-forward"
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://… (leave empty to send nowhere else)"
              className={`${themedInputClass} flex-1 min-w-[16rem] font-mono`}
              value={forward}
              onChange={(e) => setForward(e.target.value)}
            />
            <button
              type="button"
              disabled={busy || forward === twilio.forwardUrl}
              onClick={() => run(() => setSmsForwardUrl({ url: forward }))}
              className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              Save
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-500 mt-2.5 max-w-3xl">
            Twilio only lets one address receive a text, so moving to Awer would normally switch
            your old system off on the same day. Put its address here and every incoming text is
            stored here <em>and</em> passed on there, signed with your own Twilio credentials so it
            arrives looking exactly as it does today. Clear the field when you no longer need it.
          </p>
        </div>

        {/* webhook address */}
        <div className="border-t border-gray-100 bg-gray-50/70 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            In Twilio, point incoming texts here
          </div>
          <WebhookAddress url={webhookUrl} copied={copied === webhookUrl} onCopy={copyUrl} />
          <p className="text-xs leading-relaxed text-gray-500 mt-2.5 max-w-3xl">
            If your number is in a <strong className="font-semibold text-gray-700">Messaging
            Service</strong>, the service normally decides where incoming texts go — but it can be
            set to defer to the number&apos;s own webhook instead, and then the number decides.
            Only one of the two is ever being read, so don&apos;t guess: run{" "}
            <strong className="font-semibold text-gray-700">Test connection</strong> and it names
            the setting Twilio is actually using.
          </p>
        </div>
      </div>

      {/* the masked-number pool */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 p-5 border-b border-gray-100">
          <TwilioMark className="h-11 w-11 shrink-0 rounded-xl shadow-sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-[15px] font-semibold text-gray-900">Masked numbers</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${
                  activePool > 0
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-gray-100 text-gray-600 ring-gray-200"
                }`}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${activePool > 0 ? "bg-emerald-500" : "bg-gray-400"}`}
                />
                {activePool > 0 ? `${activePool} in service` : "Nothing to hand out"}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              The company numbers a cleaner is given instead of the customer&apos;s own. Turn masking
              on under <strong className="font-semibold text-gray-700">Provider</strong> — it can
              only hand out what is listed here.
            </p>
          </div>
        </div>

        {pool.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-600">
            A pooled number is one you own in Twilio and lend to a cleaner for the length of a job:
            they call or text it, we relay both ways, and neither side ever holds the other&apos;s
            real number.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pool.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 tabular-nums">{n.phoneNumber}</div>
                  <div className="truncate text-xs text-gray-500">
                    {[
                      n.label,
                      n.livePairings === 0
                        ? "Idle"
                        : `${n.livePairings} live conversation${n.livePairings === 1 ? "" : "s"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap ${
                    n.isActive
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : "bg-gray-100 text-gray-600 ring-gray-200"
                  }`}>
                  {n.isActive ? "In service" : "Off"}
                </span>
                <button
                  type="button"
                  disabled={poolBusy}
                  onClick={() => runPool(() => setProxyNumberActive(n.id, !n.isActive))}
                  className="shrink-0 rounded-lg border border-[#008C9C]/25 bg-[#008C9C]/5 px-3 py-1.5 text-xs font-semibold text-[#00707d] transition hover:bg-[#008C9C]/10 disabled:opacity-40 disabled:cursor-not-allowed">
                  {n.isActive ? "Take out of service" : "Put back in service"}
                </button>
                <button
                  type="button"
                  disabled={poolBusy}
                  onClick={() => runPool(() => removeProxyNumber(n.id))}
                  aria-label={`Remove ${n.phoneNumber}`}
                  className="shrink-0 rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* add one */}
        <div className="border-t border-gray-100 p-5">
          <label
            htmlFor="proxy-number"
            className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Add a number you own in Twilio
          </label>
          <div className="flex flex-wrap items-stretch gap-2">
            <input
              id="proxy-number"
              type="tel"
              autoComplete="off"
              spellCheck={false}
              placeholder="+15145551234"
              className={`${themedInputClass} flex-1 min-w-[12rem] font-mono`}
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
            />
            <input
              id="proxy-label"
              type="text"
              autoComplete="off"
              placeholder="Label (optional) — e.g. Montréal line 1"
              className={`${themedInputClass} flex-1 min-w-[12rem]`}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button
              type="button"
              disabled={poolBusy || !newNumber.trim()}
              onClick={() =>
                runPool(
                  () => addProxyNumber(newNumber, newLabel),
                  () => {
                    setNewNumber("");
                    setNewLabel("");
                  }
                )
              }
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#008C9C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00707d] disabled:opacity-40 disabled:cursor-not-allowed">
              {poolBusy && <Loader2 size={15} className="animate-spin" />}
              {poolBusy ? "Saving…" : "Add"}
            </button>
          </div>
          {poolMsg && (
            <div
              className={`mt-3 rounded-xl px-4 py-3 text-sm ${
                poolMsg.ok ? "bg-[#008C9C]/8 text-[#00707d]" : "bg-red-50 text-red-700"
              }`}
              role="status">
              {poolMsg.text}
            </div>
          )}
          <p className="text-xs leading-relaxed text-gray-500 mt-2.5 max-w-3xl">
            Taking a number out of service stops it being handed to anyone new; conversations already
            on it keep relaying until they expire. Removing it is permanent, so it is refused while
            anything is still live on it.
          </p>
        </div>

        {/* what to paste into each pooled number */}
        <div className="border-t border-gray-100 bg-gray-50/70 p-5 space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              On each pooled number, point &ldquo;A call comes in&rdquo; here
            </div>
            <WebhookAddress
              url={voiceWebhookUrl}
              copied={copied === voiceWebhookUrl}
              onCopy={copyUrl}
            />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              &hellip;and &ldquo;A message comes in&rdquo; here
            </div>
            <WebhookAddress url={webhookUrl} copied={copied === webhookUrl} onCopy={copyUrl} />
          </div>
          <p className="text-xs leading-relaxed text-gray-500 max-w-3xl">
            Both are <strong className="font-semibold text-gray-700">HTTP POST</strong>, and both
            belong on every number in the pool — a number missing one of them relays half a
            conversation, which is harder to notice than one that relays none.
          </p>
        </div>
      </div>
    </div>
  );
}
