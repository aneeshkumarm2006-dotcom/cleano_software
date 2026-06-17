"use client";

import { useState, useTransition } from "react";
import { redeemGiftCard } from "../actions/redeemGiftCard";

export default function GiftCardRedeemClient({
  initialCode,
}: {
  initialCode: string;
}) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; balance: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await redeemGiftCard({ code });
      if (!result.success) {
        setError(result.error ?? "Could not redeem");
        return;
      }
      setDone({ amount: result.amount ?? 0, balance: result.newBalance ?? 0 });
    });
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
          ${done.amount.toFixed(2)} added to your account
        </h2>
        <p style={{ marginTop: 10, fontSize: 14, color: "#3a5a62" }}>
          New balance: <strong>${done.balance.toFixed(2)}</strong>.
        </p>
        <p style={{ marginTop: 12, fontSize: 13, color: "#6b7d80", lineHeight: 1.6 }}>
          The credit will auto-apply next time you're charged for a booking.
        </p>
        <a
          href="/portal"
          style={{
            display: "inline-block",
            marginTop: 16,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 700,
            background: "#008C9C",
            color: "#fff",
            borderRadius: 10,
            textDecoration: "none",
          }}>
          Go to my account
        </a>
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
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "#3a5a62",
          marginBottom: 8,
          letterSpacing: "0.02em",
        }}>
        Gift card code
      </label>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="CLNO-XXXX-XXXX-XXXX"
        style={{
          width: "100%",
          padding: "12px 14px",
          fontSize: 16,
          fontFamily: "monospace",
          letterSpacing: "0.06em",
          color: "#0a1f24",
          background: "#fff",
          border: "1px solid rgba(0,140,156,0.18)",
          borderRadius: 8,
        }}
      />
      {error && (
        <p style={{ marginTop: 12, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || code.length < 6}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 16px",
          fontSize: 15,
          fontWeight: 700,
          color: "#fff",
          background: pending || code.length < 6 ? "#7daab0" : "#008C9C",
          border: "none",
          borderRadius: 10,
          cursor: pending || code.length < 6 ? "default" : "pointer",
        }}>
        {pending ? "Redeeming…" : "Redeem code"}
      </button>
      <p style={{ marginTop: 12, fontSize: 12, color: "#6b7d80", lineHeight: 1.5 }}>
        Don't have a Cleano account yet?{" "}
        <a href="/portal/setup" style={{ color: "#008C9C" }}>
          Create one
        </a>{" "}
        with the same email the gift card was sent to.
      </p>
    </div>
  );
}
