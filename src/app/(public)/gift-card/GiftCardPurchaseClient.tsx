"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createGiftCardIntent } from "./actions/createGiftCardIntent";
import { finalizeGiftCardPurchase } from "./actions/finalizeGiftCardPurchase";
import type { GiftCardCover } from "@/lib/gift-cards/covers";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface Props {
  tiers: number[];
  covers: GiftCardCover[];
  minJobPrice: number;
}

export default function GiftCardPurchaseClient({ tiers, covers, minJobPrice }: Props) {
  // Form state
  const [amount, setAmount] = useState(tiers[0]);
  const [coverKey, setCoverKey] = useState<string>(covers[0].key);
  const [purchaserName, setPurchaserName] = useState("");
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [sendToSelf, setSendToSelf] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [scheduleDelivery, setScheduleDelivery] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [agree, setAgree] = useState(false);

  // Flow state
  const [giftCardId, setGiftCardId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const effectiveRecipientName = sendToSelf ? purchaserName : recipientName;
  const effectiveRecipientEmail = sendToSelf ? purchaserEmail : recipientEmail;

  const canSubmit =
    purchaserName.trim() &&
    purchaserEmail.includes("@") &&
    effectiveRecipientName.trim() &&
    effectiveRecipientEmail.includes("@") &&
    agree &&
    !pending;

  function startCheckout() {
    setError(null);
    startTransition(async () => {
      const result = await createGiftCardIntent({
        amount,
        purchaserName,
        purchaserEmail,
        recipientName: effectiveRecipientName,
        recipientEmail: effectiveRecipientEmail,
        personalMessage,
        scheduledDeliveryDate:
          scheduleDelivery && scheduledDate ? scheduledDate : undefined,
        coverKey,
      });
      if (!result.success) {
        setError(result.error ?? "Could not start purchase");
        return;
      }
      setGiftCardId(result.giftCardId ?? null);
      setClientSecret(result.clientSecret ?? null);
    });
  }

  if (done) {
    return (
      <div
        style={{
          padding: 32,
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.12)",
          borderRadius: 16,
          textAlign: "center",
        }}>
        <h2 style={{ margin: 0, fontSize: 22, color: "#008C9C" }}>
          Gift card on its way
        </h2>
        <p style={{ marginTop: 12, fontSize: 14, color: "#3a5a62", lineHeight: 1.6 }}>
          We've emailed your receipt and {sendToSelf ? "the gift card to you" : `the gift card to ${effectiveRecipientName}`}
          {scheduleDelivery && scheduledDate
            ? ` will be delivered on ${new Date(scheduledDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`
            : "."}
        </p>
      </div>
    );
  }

  // Step 2: Stripe Elements once we have a client secret
  if (clientSecret && giftCardId) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.12)",
          borderRadius: 16,
          padding: 28,
        }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#008C9C" }}>
          Pay ${amount.toFixed(2)}
        </h2>
        <p style={{ marginTop: 8, fontSize: 13, color: "#3a5a62" }}>
          For {effectiveRecipientName}
          {sendToSelf ? " (you)" : ""} · {coverKey} cover
        </p>
        <div style={{ marginTop: 16 }}>
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <PayForm
              giftCardId={giftCardId}
              onSuccess={() => setDone(true)}
              onError={(msg) => setError(msg)}
            />
          </Elements>
        </div>
        {error && (
          <p style={{ marginTop: 12, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgba(0,140,156,0.12)",
        borderRadius: 16,
        padding: 28,
        boxShadow: "0 8px 24px rgba(0,140,156,0.06)",
      }}>
      {/* Tier picker */}
      <section style={{ marginBottom: 24 }}>
        <SectionTitle>Pick an amount</SectionTitle>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "#6b7d80" }}>
          Our minimum job price is ${minJobPrice}, so we recommend at least $150 to cover a full service.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 10,
          }}>
          {tiers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setAmount(t)}
              style={{
                padding: "16px 12px",
                fontSize: 18,
                fontWeight: 700,
                background: amount === t ? "#008C9C" : "#fff",
                color: amount === t ? "#fff" : "#0a1f24",
                border: amount === t ? "2px solid #008C9C" : "1px solid rgba(0,140,156,0.18)",
                borderRadius: 10,
                cursor: "pointer",
                transition: "all 120ms ease",
              }}>
              ${t}
            </button>
          ))}
        </div>
      </section>

      {/* Cover picker */}
      <section style={{ marginBottom: 24 }}>
        <SectionTitle>Cover design</SectionTitle>
        <div
          style={{
            marginTop: 8,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
          }}>
          {covers.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCoverKey(c.key)}
              style={{
                padding: 0,
                border:
                  coverKey === c.key
                    ? "2px solid #008C9C"
                    : "1px solid rgba(0,140,156,0.18)",
                borderRadius: 10,
                overflow: "hidden",
                cursor: "pointer",
                background: "transparent",
                textAlign: "left",
              }}>
              <div
                style={{
                  height: 90,
                  background: c.gradient,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}>
                ${amount}
              </div>
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#0a1f24",
                  background: "#fff",
                }}>
                {c.name}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Buyer details */}
      <section style={{ marginBottom: 16 }}>
        <SectionTitle>Your details</SectionTitle>
        <Row>
          <Field label="Your name" required>
            <input
              type="text"
              value={purchaserName}
              onChange={(e) => setPurchaserName(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Your email" required>
            <input
              type="email"
              value={purchaserEmail}
              onChange={(e) => setPurchaserEmail(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </Row>
      </section>

      {/* Recipient */}
      <section style={{ marginBottom: 16 }}>
        <SectionTitle>Recipient</SectionTitle>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "6px 0 12px",
            fontSize: 14,
            color: "#3a5a62",
            cursor: "pointer",
          }}>
          <input
            type="checkbox"
            checked={sendToSelf}
            onChange={(e) => setSendToSelf(e.target.checked)}
          />
          This gift card is for me
        </label>
        {!sendToSelf && (
          <Row>
            <Field label="Recipient name" required>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Recipient email" required>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </Row>
        )}
        <Field label="Personal message (optional)">
          <textarea
            value={personalMessage}
            onChange={(e) => setPersonalMessage(e.target.value)}
            rows={3}
            placeholder="Happy birthday! Treat yourself to a clean home."
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>
      </section>

      {/* Scheduled delivery */}
      <section style={{ marginBottom: 20 }}>
        <SectionTitle>Delivery</SectionTitle>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "6px 0 12px",
            fontSize: 14,
            color: "#3a5a62",
            cursor: "pointer",
          }}>
          <input
            type="checkbox"
            checked={scheduleDelivery}
            onChange={(e) => setScheduleDelivery(e.target.checked)}
          />
          Schedule delivery for a specific date
        </label>
        {scheduleDelivery && (
          <Field label="Deliver on">
            <input
              type="date"
              value={scheduledDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setScheduledDate(e.target.value)}
              style={inputStyle}
            />
          </Field>
        )}
        {!scheduleDelivery && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7d80" }}>
            We'll email it right after payment goes through.
          </p>
        )}
      </section>

      {/* Terms checkbox */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
          fontSize: 13,
          color: "#3a5a62",
          cursor: "pointer",
        }}>
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
        />
        I understand that gift cards are non-refundable once redeemed and our minimum job price is ${minJobPrice}.
      </label>

      {error && (
        <p style={{ marginBottom: 12, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={startCheckout}
        disabled={!canSubmit}
        style={{
          width: "100%",
          padding: "14px 16px",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: canSubmit ? "#008C9C" : "#7daab0",
          border: "none",
          borderRadius: 10,
          cursor: canSubmit ? "pointer" : "default",
        }}>
        {pending ? "Setting up payment…" : `Continue to payment · $${amount.toFixed(2)}`}
      </button>
    </div>
  );
}

function PayForm({
  giftCardId,
  onSuccess,
  onError,
}: {
  giftCardId: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (result.error) {
      // PI may already be succeeded if user retried.
      const pi = result.error.payment_intent;
      if (pi?.status === "succeeded") {
        const fin = await finalizeGiftCardPurchase(giftCardId);
        if (fin.success) {
          onSuccess();
          return;
        }
      }
      onError(result.error.message ?? "Payment failed");
      setBusy(false);
      return;
    }
    const fin = await finalizeGiftCardPurchase(giftCardId);
    if (fin.success) {
      onSuccess();
    } else {
      onError(fin.error ?? "Could not finalize purchase");
    }
    setBusy(false);
  }

  return (
    <div>
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        type="button"
        disabled={busy}
        onClick={pay}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "14px 16px",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: busy ? "#7daab0" : "#008C9C",
          border: "none",
          borderRadius: 10,
          cursor: busy ? "default" : "pointer",
        }}>
        {busy ? "Paying…" : "Pay now"}
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "#008C9C",
      }}>
      {children}
    </h2>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "#3a5a62",
          marginBottom: 6,
          letterSpacing: "0.02em",
        }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  fontSize: 14,
  color: "#0a1f24",
  background: "#fff",
  border: "1px solid rgba(0,140,156,0.18)",
  borderRadius: 8,
};
