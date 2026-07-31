"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Check } from "lucide-react";
import {
  getBookingPaymentMethod,
  setBookingPaymentMethod,
  type BookingPaymentMethodView,
} from "../../../actions/paymentMethods";

function brandLabel(brand: string | null): string {
  if (!brand) return "Card";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function expLabel(month: number | null, year: number | null): string {
  if (!month || !year) return "—";
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/**
 * Lets the customer choose which of their saved cards this one booking will be
 * charged on (CLN-P1-7-07). Loads its own data so the booking page keeps
 * rendering if Stripe is unreachable — the same choice PaymentMethods.tsx makes
 * on the account page.
 */
export default function BookingPaymentMethod({ jobId }: { jobId: string }) {
  const [data, setData] = useState<BookingPaymentMethodView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getBookingPaymentMethod(jobId);
    if (res.success) {
      setData(res.data);
      setError(null);
    } else {
      setData(null);
      setError(res.error);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  async function choose(paymentMethodId: string | null) {
    if (saving) return;
    setSaving(paymentMethodId ?? "__default__");
    setError(null);
    setNotice(null);
    const res = await setBookingPaymentMethod(jobId, paymentMethodId);
    setSaving(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setNotice(
      paymentMethodId
        ? "This booking will be charged on the card you picked."
        : "This booking will use your default card."
    );
    await load();
  }

  // Nothing to choose between, and nothing useful to say — stay out of the way.
  if (!loading && !error && (!data || data.methods.length === 0)) return null;

  return (
    <section className="cl-tile cl-tile-pad-lg">
      <h2 className="cl-title-md" style={{ marginBottom: 6 }}>
        Payment method for this booking
      </h2>
      <p className="cl-subtitle" style={{ margin: "0 0 18px" }}>
        Choose which of your saved cards this cleaning is charged on. It only
        affects this booking — your other bookings are unchanged. Manage your
        cards in{" "}
        <Link href="/account" className="cl-link">
          Account
        </Link>
        .
      </p>

      {error && (
        <p style={{ fontSize: 13.5, color: "#b91c1c", margin: "0 0 14px" }}>
          {error}
        </p>
      )}
      {notice && (
        <p style={{ fontSize: 13.5, color: "#047857", margin: "0 0 14px" }}>
          {notice}
        </p>
      )}

      {loading ? (
        <p className="cl-subtitle" style={{ margin: 0 }}>
          Loading your cards…
        </p>
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.methods.map((m) => {
            const selected = data.pinnedPaymentMethodId === m.paymentMethodId;
            const busy = saving === m.paymentMethodId;
            return (
              <button
                key={m.paymentMethodId}
                type="button"
                onClick={() => choose(m.paymentMethodId)}
                disabled={!!saving || m.isExpired}
                aria-pressed={selected}
                className={`cl-card-choice${selected ? " selected" : ""}`}>
                <CreditCard size={16} aria-hidden="true" />
                <span className="cl-card-choice-meta">
                  <strong>
                    {brandLabel(m.brand)} •••• {m.last4 ?? "????"}
                  </strong>
                  <span>
                    Expires {expLabel(m.expMonth, m.expYear)}
                    {m.isDefault ? " · your default card" : ""}
                    {m.isExpired ? " · expired" : ""}
                  </span>
                </span>
                {selected && <Check size={16} aria-hidden="true" />}
                {busy && <span style={{ fontSize: 12 }}>Saving…</span>}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => choose(null)}
            disabled={!!saving}
            aria-pressed={data.pinnedPaymentMethodId === null}
            className={`cl-card-choice${
              data.pinnedPaymentMethodId === null ? " selected" : ""
            }`}>
            <CreditCard size={16} aria-hidden="true" />
            <span className="cl-card-choice-meta">
              <strong>Use my default card</strong>
              <span>
                Follows whichever card is your default when the charge is made.
              </span>
            </span>
            {data.pinnedPaymentMethodId === null && (
              <Check size={16} aria-hidden="true" />
            )}
          </button>

          <p
            style={{
              fontSize: 12,
              color: "var(--primary-50)",
              margin: "6px 0 0",
              lineHeight: 1.5,
            }}>
            A card connected to an upcoming booking can&apos;t be removed until
            that booking is completed or cancelled.
          </p>
        </div>
      ) : null}
    </section>
  );
}
