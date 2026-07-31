"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { CreditCard, Star, AlertTriangle, Plus, Trash2 } from "lucide-react";
import {
  listMyPaymentMethods,
  createMySetupIntent,
  finalizeMyCardSetup,
  setMyDefaultPaymentMethod,
  removeMyPaymentMethod,
  type CustomerPaymentMethod,
} from "../../actions/paymentMethods";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

function brandLabel(brand: string | null): string {
  if (!brand) return "Card";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function expLabel(month: number | null, year: number | null): string {
  if (!month || !year) return "—";
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/** The card-entry form itself, rendered inside <Elements>. */
function AddCardFields({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;

    setBusy(true);
    setError(null);

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError || !setupIntent) {
      setError(confirmError?.message ?? "That card could not be saved.");
      setBusy(false);
      return;
    }

    const res = await finalizeMyCardSetup(setupIntent.id);
    if (!res.success) {
      setError(res.error);
      setBusy(false);
      return;
    }

    setBusy(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p style={{ marginTop: 12, fontSize: 13, color: "#991b1b" }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button type="submit" className="cl-btn cl-btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save card"}
        </button>
        <button
          type="button"
          className="cl-btn"
          onClick={onCancel}
          disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PaymentMethods() {
  const [methods, setMethods] = useState<CustomerPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listMyPaymentMethods();
    if (!res.success) {
      setError(res.error);
    } else {
      setMethods(res.methods);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startAdd() {
    setError(null);
    setNotice(null);
    const res = await createMySetupIntent();
    if (!res.success) {
      setError(res.error);
      return;
    }
    setClientSecret(res.clientSecret);
    setAdding(true);
  }

  function cancelAdd() {
    setAdding(false);
    setClientSecret(null);
  }

  async function handleSaved() {
    cancelAdd();
    setNotice("Card saved. It's now your default for future bookings.");
    await refresh();
  }

  async function handleSetDefault(pm: CustomerPaymentMethod) {
    setBusyId(pm.paymentMethodId);
    setError(null);
    setNotice(null);
    const res = await setMyDefaultPaymentMethod(pm.paymentMethodId);
    if (!res.success) setError(res.error);
    else setNotice("Default payment method updated.");
    setBusyId(null);
    await refresh();
  }

  async function handleRemove(pm: CustomerPaymentMethod) {
    if (
      !confirm(
        `Remove ${brandLabel(pm.brand)} •••• ${pm.last4 ?? "????"} from your account?`
      )
    ) {
      return;
    }
    setBusyId(pm.paymentMethodId);
    setError(null);
    setNotice(null);
    const res = await removeMyPaymentMethod(pm.paymentMethodId);
    if (!res.success) {
      // Includes the "add another card first" explanation when removal is
      // blocked because this is the only card on an active account.
      setError(res.error);
    } else {
      setNotice(res.warning ?? "Card removed.");
    }
    setBusyId(null);
    await refresh();
  }

  return (
    <div className="cl-tile cl-tile-pad-lg" style={{ marginTop: 24 }}>
      <h2 className="cl-title-md" style={{ marginBottom: 8 }}>
        Payment methods
      </h2>
      <p className="cl-subtitle" style={{ marginBottom: 20 }}>
        Cards saved for your bookings. We never see or store your full card
        number — it's held securely by our payment processor.
      </p>

      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: 13,
            marginBottom: 16,
          }}>
          {error}
        </div>
      )}

      {notice && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(0,140,156,0.10)",
            color: "#00424a",
            fontSize: 13,
            marginBottom: 16,
          }}>
          {notice}
        </div>
      )}

      {loading ? (
        <p className="cl-subtitle">Loading your payment methods…</p>
      ) : methods.length === 0 ? (
        <p className="cl-subtitle">You don't have a card saved yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {methods.map((pm) => {
            const busy = busyId === pm.paymentMethodId;
            return (
              <div
                key={pm.paymentMethodId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  border: "1px solid rgba(0,140,156,0.14)",
                  borderRadius: 12,
                  opacity: busy ? 0.6 : 1,
                  flexWrap: "wrap",
                }}>
                <CreditCard
                  size={16}
                  style={{ color: "#008C9C", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {brandLabel(pm.brand)} •••• {pm.last4 ?? "????"}
                    </span>
                    {pm.isDefault && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "rgba(0,140,156,0.12)",
                          color: "#008C9C",
                        }}>
                        <Star size={9} style={{ fill: "#008C9C" }} />
                        Default
                      </span>
                    )}
                    {pm.isExpired && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#fee2e2",
                          color: "#991b1b",
                        }}>
                        <AlertTriangle size={9} />
                        Expired
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#3a5a62", marginTop: 2 }}>
                    Expires {expLabel(pm.expMonth, pm.expYear)}
                    {pm.upcomingBookings > 0 && (
                      // Tells the customer which bookings stay on an older card
                      // after they add a replacement.
                      <>
                        {" · "}
                        {pm.upcomingBookings} upcoming booking
                        {pm.upcomingBookings === 1 ? "" : "s"} will be charged to
                        this card
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {!pm.isDefault && (
                    <button
                      type="button"
                      className="cl-btn"
                      disabled={busy}
                      onClick={() => handleSetDefault(pm)}
                      style={{ fontSize: 12, padding: "6px 11px" }}>
                      Make default
                    </button>
                  )}
                  <button
                    type="button"
                    className="cl-btn"
                    disabled={busy}
                    onClick={() => handleRemove(pm)}
                    style={{
                      fontSize: 12,
                      padding: "6px 11px",
                      color: "#991b1b",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}>
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && clientSecret ? (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <AddCardFields onSaved={handleSaved} onCancel={cancelAdd} />
        </Elements>
      ) : (
        <button
          type="button"
          className="cl-btn"
          onClick={startAdd}
          style={{
            marginTop: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
          <Plus size={14} />
          Add a card
        </button>
      )}
    </div>
  );
}
