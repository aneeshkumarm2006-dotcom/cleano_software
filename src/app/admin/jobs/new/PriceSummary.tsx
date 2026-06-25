"use client";

import { useEffect, useState } from "react";
import { TrendingUp, DollarSign } from "lucide-react";

export default function PriceSummary() {
  const [price, setPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [tip, setTip] = useState(0);
  const [parking, setParking] = useState(0);
  const [employeePay, setEmployeePay] = useState(0);

  useEffect(() => {
    const fields = [
      { id: "price", setter: setPrice },
      { id: "discountAmount", setter: setDiscount },
      { id: "totalTip", setter: setTip },
      { id: "parking", setter: setParking },
      { id: "employeePay", setter: setEmployeePay },
    ];

    const handlers: Array<{ el: HTMLInputElement; fn: () => void }> = [];

    for (const { id, setter } of fields) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) continue;
      const fn = () => setter(parseFloat(el.value) || 0);
      fn();
      el.addEventListener("input", fn);
      handlers.push({ el, fn });
    }

    return () => {
      for (const { el, fn } of handlers) {
        el.removeEventListener("input", fn);
      }
    };
  }, []);

  const subtotal = price - discount + tip + parking;
  const margin = subtotal - employeePay;

  if (price === 0 && discount === 0 && tip === 0 && parking === 0 && employeePay === 0) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 20px",
        background: "rgba(0,140,156,0.04)",
        border: "1px solid rgba(0,140,156,0.10)",
        borderRadius: 12,
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <DollarSign size={15} style={{ color: "var(--primary-60)" }} />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          Client total
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginLeft: 4 }}>
          ${subtotal.toFixed(2)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TrendingUp size={15} style={{ color: "var(--primary-60)" }} />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          Net margin
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            marginLeft: 4,
            color: margin >= 0 ? "var(--emerald-600)" : "var(--error)",
          }}
        >
          ${margin.toFixed(2)}
        </span>
      </div>
      {discount > 0 && (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
          −${discount.toFixed(2)} discount applied
        </div>
      )}
    </div>
  );
}
