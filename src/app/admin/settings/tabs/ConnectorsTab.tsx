"use client";

import { useState, useTransition } from "react";
import { Check, Plug, X } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  connectTwilio,
  disconnectTwilio,
  testTwilio,
  type TwilioTest,
} from "../../actions/twilioConnection";

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

export default function ConnectorsTab({ twilio, webhookUrl }: Props) {
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [test, setTest] = useState<TwilioTest | null>(null);
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      setTest(null);
      const r = await fn();
      setMsg({ type: r.ok ? "success" : "error", text: r.message });
      if (r.ok) {
        setSid("");
        setToken("");
      }
    });

  return (
    <SectionCard
      title="Texting (Twilio)"
      description="Where your text messages come from and go to. Use your own Twilio account if you have one — your numbers, your bill, your sender registration — or leave this alone and texts run on Awer's account."
      icon={Plug}>
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-3 text-sm">
          <div className="font-medium text-gray-900">
            {twilio.unreadable
              ? "Reconnect needed"
              : twilio.connected
                ? "Connected to your own Twilio account"
                : twilio.usingPlatform
                  ? "Using Awer's Twilio account"
                  : "Not set up"}
          </div>
          <div className="text-gray-500 mt-0.5">
            {twilio.unreadable ? (
              "The saved credentials can no longer be read, so texting has stopped. Enter them again below."
            ) : twilio.connected ? (
              <>
                Account {twilio.accountSid} · token {twilio.tokenHint}
                {twilio.connectedAt
                  ? ` · connected ${new Date(twilio.connectedAt).toLocaleDateString("en-CA")}`
                  : ""}
              </>
            ) : twilio.usingPlatform ? (
              "Nothing to do. Connect your own account only if you already have one."
            ) : (
              "No Twilio account is available, so texts cannot be sent or received yet."
            )}
          </div>
          <div className="text-gray-500 mt-1">
            {twilio.smsNumber
              ? `Your number: ${twilio.smsNumber}`
              : "No number assigned yet — ask Awer support to set one up."}
          </div>
        </div>

        {!twilio.connected && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Account SID">
              <Input
                variant="form"
                type="text"
                placeholder="ACxxxxxxxx…"
                value={sid}
                onChange={(e) => setSid(e.target.value)}
              />
            </Field>
            <Field label="Auth token">
              <Input
                variant="form"
                type="password"
                placeholder="Your Twilio auth token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!twilio.connected ? (
            <Button
              type="button"
              disabled={busy || !sid.trim() || !token.trim()}
              onClick={() => run(() => connectTwilio({ accountSid: sid, authToken: token }))}>
              {busy ? "Checking with Twilio…" : "Connect Twilio"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => run(disconnectTwilio)}>
              {busy ? "Working…" : "Disconnect"}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              start(async () => {
                setMsg(null);
                setTest(await testTwilio());
              })
            }>
            {busy ? "Testing…" : "Test connection"}
          </Button>
        </div>

        {test && (
          <div className="rounded-lg border border-gray-200 divide-y">
            {test.checks.map((c) => (
              <div key={c.label} className="flex gap-2.5 p-3 text-sm">
                {c.pass ? (
                  <Check size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <X size={16} className="text-red-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-medium text-gray-900">{c.label}</div>
                  <div className="text-gray-600">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
          <div className="font-medium text-gray-900 mb-1">In Twilio, point incoming texts here</div>
          <code className="block text-xs bg-white border border-gray-200 rounded px-2 py-1.5 break-all">
            {webhookUrl}
          </code>
          <p className="text-xs text-gray-500 mt-2">
            If your number uses a <strong>Messaging Service</strong>, set the address there — a
            Messaging Service always overrides the number&apos;s own setting, so filling in only the
            number looks correct and delivers nothing. Use <strong>Test connection</strong> above
            afterwards: it asks Twilio what is actually configured rather than taking our word for
            it.
          </p>
        </div>

        {msg && <Feedback msg={msg} />}
      </div>
    </SectionCard>
  );
}
