"use client";

import { useEffect, useMemo, useState } from "react";
import { stripeFor } from "@/lib/stripe-browser";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { saveClientCardOnFile } from "../actions/saveClientCardOnFile";

interface Props {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  /** Fires after the card is persisted on the Client record so the parent
   *  modal can re-enable the "Create Job" submit. */
  onSaved: (paymentMethodId: string) => void;
}

/**
 * Admin-only panel that creates a SetupIntent for the selected Client
 * and lets the admin enter a card. Once Stripe confirms, the payment
 * method is stored on `Client.defaultPaymentMethodId` so future charges
 * can run off-session.
 */
export default function SaveCardOnFile({
  clientId,
  clientName,
  clientEmail,
  onSaved,
}: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // This workspace's publishable key, returned alongside the SetupIntent so
  // the two can never come from different Stripe accounts.
  const [pubKey, setPubKey] = useState<string | null>(null);
  const stripePromise = useMemo(() => stripeFor(pubKey), [pubKey]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setClientSecret(null);
    fetch("/api/stripe/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        name: clientName,
        email: clientEmail ?? `${clientId}@cleano.placeholder`,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
          setPubKey(data.publishableKey ?? null);
        } else {
          setError(data.error ?? "Could not initialize card form.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not initialize card form.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, clientName, clientEmail]);

  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        background: "#008C9C0d",
        border: "1px dashed rgba(0,140,156,0.3)",
        borderRadius: 10,
      }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#008C9C",
          marginBottom: 6,
        }}>
        Save card on file
      </div>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 12,
          color: "rgba(0,140,156,0.7)",
          lineHeight: 1.5,
        }}>
        Enter the customer's card now and we'll charge it after the job
        is complete. Card is stored securely with Stripe.
      </p>

      {loading && (
        <p style={{ fontSize: 13, color: "rgba(0,140,156,0.6)" }}>
          Loading secure card form…
        </p>
      )}
      {error && (
        <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
          {error}
        </p>
      )}

      {clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: "stripe" } }}>
          <Inner
            clientId={clientId}
            setupIntentId={clientSecret.split("_secret_")[0]}
            onSaved={onSaved}
          />
        </Elements>
      )}

      {/* An intent exists but this workspace has no publishable key, so there
          is nothing to mount the card field with. Previously this rendered an
          empty <Elements> and an admin saw blank space. */}
      {clientSecret && !stripePromise && (
        <p style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
          This workspace has no Stripe publishable key saved. Add it in
          Settings &rarr; Connectors before taking cards.
        </p>
      )}
    </div>
  );
}

function Inner({
  clientId,
  setupIntentId,
  onSaved,
}: {
  clientId: string;
  setupIntentId: string;
  onSaved: (pm: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      setErr(result.error.message ?? "Could not save card.");
      setBusy(false);
      return;
    }
    const persisted = await saveClientCardOnFile({
      clientId,
      setupIntentId,
    });
    if (!persisted.success) {
      setErr(persisted.error ?? "Card saved with Stripe but not linked.");
      setBusy(false);
      return;
    }
    setSaved(true);
    onSaved(persisted.paymentMethodId ?? "");
    setBusy(false);
  }

  if (saved) {
    return (
      <div
        style={{
          padding: "8px 12px",
          background: "#dcfce7",
          color: "#166534",
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 8,
        }}>
        ✓ Card saved to file. You can create the job now.
      </div>
    );
  }

  return (
    <div>
      <PaymentElement options={{ layout: "tabs" }} />
      {err && (
        <p style={{ marginTop: 8, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
          {err}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        style={{
          marginTop: 12,
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          background: busy ? "#7daab0" : "#008C9C",
          border: "none",
          borderRadius: 8,
          cursor: busy ? "default" : "pointer",
        }}>
        {busy ? "Saving…" : "Save card on file"}
      </button>
    </div>
  );
}
