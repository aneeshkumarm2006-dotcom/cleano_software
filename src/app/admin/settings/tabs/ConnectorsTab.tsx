"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import {
  connectTwilio,
  disconnectTwilio,
  testTwilio,
  type TwilioTest,
} from "../../actions/twilioConnection";
import { themedInputClass } from "./_shared";

export interface TwilioStatus {
  connected: boolean;
  accountSid: string | null;
  tokenHint: string | null;
  connectedAt: string | null;
  unreadable: boolean;
  usingPlatform: boolean;
  smsNumber: string | null;
}

interface Props {
  twilio: TwilioStatus;
  /** Where this workspace's Twilio webhook should point. */
  webhookUrl: string;
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

export default function ConnectorsTab({ twilio, webhookUrl }: Props) {
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<TwilioTest | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();

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

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the address is on screen to copy by hand */
    }
  }

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
          {!twilio.smsNumber && (
            <p className="text-sm text-gray-500 mt-3">
              A number is assigned by Awer support — ask them to set one up for this workspace.
            </p>
          )}
        </div>

        {/* connect / disconnect */}
        <div className="p-5 space-y-4">
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
                disabled={busy || !sid.trim() || !token.trim()}
                onClick={() => run(() => connectTwilio({ accountSid: sid, authToken: token }))}
                className="inline-flex items-center gap-2 rounded-xl bg-[#008C9C] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00707d] disabled:opacity-40 disabled:cursor-not-allowed">
                {busy && <Loader2 size={15} className="animate-spin" />}
                {busy ? "Checking with Twilio…" : "Connect Twilio"}
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

        {/* webhook address */}
        <div className="border-t border-gray-100 bg-gray-50/70 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            In Twilio, point incoming texts here
          </div>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] font-mono text-gray-800 break-all">
              {webhookUrl}
            </code>
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-500 mt-2.5 max-w-3xl">
            If your number uses a <strong className="font-semibold text-gray-700">Messaging
            Service</strong>, set the address there. A Messaging Service always overrides the
            number&apos;s own setting, so filling in only the number looks correct and delivers
            nothing. Then use <strong className="font-semibold text-gray-700">Test connection</strong> —
            it asks Twilio what is actually configured rather than taking our word for it.
          </p>
        </div>
      </div>
    </div>
  );
}
