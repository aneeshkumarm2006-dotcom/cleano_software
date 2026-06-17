"use client";

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { createSetupIntentForToken } from "./actions/createSetupIntent";
import { finalizeCardSetup } from "./actions/finalizeCardSetup";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

export default function AddCardForm({ token }: { token: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [setupIntentId, setSetupIntentId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createSetupIntentForToken(token)
      .then((r) => {
        if (cancelled) return;
        if (!r.success) {
          setError(r.error ?? "Could not initialize card form");
        } else {
          setClientSecret(r.clientSecret ?? null);
          setSetupIntentId(r.setupIntentId ?? null);
          setCustomerName(r.customerName ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not initialize card form");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div
        style={{
          padding: 28,
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.12)",
          borderRadius: 16,
          textAlign: "center",
          color: "#3a5a62",
          fontSize: 14,
        }}>
        Loading secure card form…
      </div>
    );
  }

  if (error || !clientSecret || !setupIntentId) {
    return (
      <div
        style={{
          padding: 24,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 14,
          color: "#991b1b",
          fontSize: 14,
          fontWeight: 600,
          textAlign: "center",
        }}>
        {error ?? "Could not load card form"}
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <Inner token={token} setupIntentId={setupIntentId} customerName={customerName} />
    </Elements>
  );
}

function Inner({
  token,
  setupIntentId,
  customerName,
}: {
  token: string;
  setupIntentId: string;
  customerName: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "Could not save card");
      setBusy(false);
      return;
    }
    const persisted = await finalizeCardSetup({ token, setupIntentId });
    if (!persisted.success) {
      setError(persisted.error ?? "Could not save card");
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  }

  if (done) {
    return (
      <div
        style={{
          padding: 28,
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.12)",
          borderRadius: 16,
          textAlign: "center",
        }}>
        <h2 style={{ margin: 0, fontSize: 20, color: "#008C9C" }}>
          Card saved
        </h2>
        <p style={{ marginTop: 10, fontSize: 14, color: "#3a5a62", lineHeight: 1.6 }}>
          Thanks{customerName ? `, ${customerName.split(" ")[0]}` : ""}. Your card is on file and will be charged after your cleaning is complete.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 28,
        background: "#fff",
        border: "1px solid rgba(0,140,156,0.12)",
        borderRadius: 16,
      }}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p style={{ marginTop: 12, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 16px",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: busy ? "#7daab0" : "#008C9C",
          border: "none",
          borderRadius: 10,
          cursor: busy ? "default" : "pointer",
        }}>
        {busy ? "Saving…" : "Save card"}
      </button>
      <p style={{ marginTop: 12, fontSize: 11, color: "#6b7d80", textAlign: "center" }}>
        Card details are processed by Stripe. Cleano never sees your full card number.
      </p>
    </div>
  );
}
