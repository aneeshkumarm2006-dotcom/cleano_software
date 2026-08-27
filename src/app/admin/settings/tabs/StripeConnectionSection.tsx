"use client";

import { useEffect, useState, useTransition } from "react";
import { CreditCard, ShieldCheck, TriangleAlert } from "lucide-react";

import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

import {
  disconnectStripe,
  readStripeStatus,
  saveStripeCredentials,
} from "../../actions/stripeCredentials";
import { SectionCard, Field, Feedback, type Msg } from "./_shared";

/**
 * Connecting this company's own Stripe account.
 *
 * Payments used to run on one key belonging to the platform, which meant a
 * second company's customers would have paid into the first company's bank.
 * Each workspace now brings its own account, and one with none cannot take
 * cards at all — which the status line says plainly, because a booking page
 * that silently refuses every payment is the worst version of this.
 *
 * The saved secret is never sent back to the browser. Only its last four
 * characters are, which is enough to answer "which key is in here?" — the same
 * thing Stripe's own dashboard shows.
 */

type Status = Awaited<ReturnType<typeof readStripeStatus>>;

export default function StripeConnectionSection() {
  const [status, setStatus] = useState<Status>(null);
  const [loading, setLoading] = useState(true);
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () =>
    readStripeStatus()
      .then(setStatus)
      .finally(() => setLoading(false));

  useEffect(() => {
    void refresh();
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await saveStripeCredentials({ secretKey, publishableKey, webhookSecret });
      if (res.ok) {
        setSecretKey("");
        setWebhookSecret("");
        setMsg({ type: "success", text: `Connected. Saved key ending ${res.hint ?? ""}.` });
        await refresh();
      } else {
        setMsg({ type: "error", text: res.error });
      }
    });
  }

  function disconnect() {
    setMsg(null);
    startTransition(async () => {
      const res = await disconnectStripe();
      setMsg(
        res.ok
          ? { type: "success", text: "Disconnected. This workspace can no longer take card payments." }
          : { type: "error", text: res.error },
      );
      await refresh();
    });
  }

  const connected = status?.connected ?? false;
  const usingPlatformKey = status?.source === "environment";

  return (
    <SectionCard icon={CreditCard} title="Stripe account">
      {loading ? (
        <p className="text-sm text-[#008C9C]/60">Checking…</p>
      ) : (
        <>
          {/* State in words and shape, not colour alone. */}
          <div
            className="flex items-start gap-3 rounded-lg border p-3 mb-4"
            style={{
              borderColor: connected ? "rgba(0,140,156,0.3)" : "rgba(180,83,9,0.35)",
              background: connected ? "rgba(0,140,156,0.06)" : "rgba(253,230,138,0.25)",
            }}
          >
            {connected ? (
              <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <div className="text-sm">
              {connected ? (
                <>
                  <strong>Card payments are on.</strong>{" "}
                  {usingPlatformKey ? (
                    <>Using the account this workspace was originally set up with.</>
                  ) : (
                    <>
                      Using this workspace&rsquo;s own Stripe account
                      {status?.keyHint ? <> (key ending {status.keyHint})</> : null}.
                    </>
                  )}
                  {!status?.webhookConfigured && (
                    <>
                      {" "}
                      No webhook signing secret is saved, so Stripe cannot tell this
                      workspace when a payment succeeds outside the booking page.
                    </>
                  )}
                </>
              ) : status?.reason === "unreadable" ? (
                <>
                  <strong>The saved key could not be read.</strong> It was stored with a
                  different encryption key than this deployment is using. Enter the keys
                  again below.
                </>
              ) : (
                <>
                  <strong>No Stripe account is connected, so this workspace cannot take
                  card payments.</strong>{" "}
                  Customers can still be booked in by your team; the online booking page
                  will not be able to take a deposit until you connect an account, or you
                  set the booking deposit to $0.
                </>
              )}
            </div>
          </div>

          {status && !status.canStoreSecrets && (
            <p className="text-sm mb-4" style={{ color: "#92400e" }}>
              This deployment has no SECRETS_KEY set, so credentials cannot be stored
              securely and saving is disabled. Your administrator can generate one with{" "}
              <code>openssl rand -hex 32</code>.
            </p>
          )}

          <form onSubmit={save} className="grid gap-4">
            <Field label="Secret key">
              <Input
                variant="form"
                type="password"
                autoComplete="off"
                placeholder={connected ? "Enter a new key to replace the saved one" : "sk_live_…"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
              <p className="text-sm text-[#008C9C]/60 mt-1">
                From Stripe → Developers → API keys. It is encrypted before it is stored
                and never shown again.
              </p>
            </Field>

            <Field label="Publishable key">
              <Input
                variant="form"
                type="text"
                autoComplete="off"
                placeholder="pk_live_…"
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
              />
              <p className="text-sm text-[#008C9C]/60 mt-1">
                Safe to share — it is what the card form in your customers&rsquo; browsers
                uses. Must be from the same Stripe mode as the secret key.
              </p>
            </Field>

            <Field label="Webhook signing secret (optional)">
              <Input
                variant="form"
                type="password"
                autoComplete="off"
                placeholder="whsec_…"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
              <p className="text-sm text-[#008C9C]/60 mt-1">
                Add an endpoint in Stripe pointing at this workspace&rsquo;s own address,
                then paste its signing secret here. Leave blank to keep the one already
                saved.
              </p>
            </Field>

            {msg && <Feedback msg={msg} />}

            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={pending || !secretKey || !publishableKey || !status?.canStoreSecrets}
              >
                {pending ? "Checking with Stripe…" : connected ? "Replace keys" : "Connect Stripe"}
              </Button>
              {connected && !usingPlatformKey && (
                <Button type="button" variant="secondary" onClick={disconnect} disabled={pending}>
                  Disconnect
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </SectionCard>
  );
}
