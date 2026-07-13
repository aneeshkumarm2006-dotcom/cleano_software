"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  Star,
  Trash2,
  Plus,
  Mail,
  AlertTriangle,
  X,
} from "lucide-react";
import SaveCardOnFile from "@/app/admin/jobs/SaveCardOnFile";
import {
  listClientPaymentMethods,
  removeClientPaymentMethod,
  sendClientAddCardLink,
  setDefaultClientPaymentMethod,
} from "../../actions/clientPaymentMethods";
import type { ClientPaymentMethodDTO } from "../../actions/clientPaymentMethods.types";

interface Props {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
}

type Msg = { type: "success" | "error" | "warn"; text: string } | null;

const MSG_STYLE: Record<
  NonNullable<Msg>["type"],
  { bg: string; fg: string }
> = {
  success: { bg: "rgba(5,150,105,0.10)", fg: "#065f46" },
  error: { bg: "#fee2e2", fg: "#991b1b" },
  warn: { bg: "#fffbeb", fg: "#92400e" },
};

function brandLabel(brand: string | null): string {
  if (!brand) return "Card";
  return brand
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function expLabel(month: number | null, year: number | null): string {
  if (!month || !year) return "—";
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/**
 * Payment-method management for a client profile: list saved cards, set the
 * default, remove one, and add a new one (Stripe Elements inline, or by emailing
 * the customer a one-time add-card link).
 *
 * Cards live in Stripe — this only ever handles `pm_…` ids plus the brand /
 * last4 / expiry Stripe returns. No raw card data touches the app.
 */
export default function ClientPaymentMethods({
  clientId,
  clientName,
  clientEmail,
}: Props) {
  const [methods, setMethods] = useState<ClientPaymentMethodDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [synced, setSynced] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listClientPaymentMethods(clientId);
    if (res.success) {
      setMethods(res.methods);
      setSynced(res.synced);
    } else {
      setMsg({ type: "error", text: res.error });
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSetDefault(pm: ClientPaymentMethodDTO) {
    setBusyId(pm.id);
    setMsg(null);
    const res = await setDefaultClientPaymentMethod({
      clientId,
      paymentMethodId: pm.stripePaymentMethodId,
    });
    if (res.success) {
      setMsg({
        type: "success",
        text: `${brandLabel(pm.brand)} •••• ${pm.last4 ?? "????"} is now the default card.`,
      });
      await load();
    } else {
      setMsg({ type: "error", text: res.error });
    }
    setBusyId(null);
  }

  async function handleRemove(pm: ClientPaymentMethodDTO) {
    const confirmed = window.confirm(
      `Remove ${brandLabel(pm.brand)} •••• ${pm.last4 ?? "????"} from ${clientName}?`
    );
    if (!confirmed) return;

    setBusyId(pm.id);
    setMsg(null);
    const res = await removeClientPaymentMethod({
      clientId,
      paymentMethodId: pm.stripePaymentMethodId,
    });
    if (res.success) {
      setMsg(
        res.warning
          ? { type: "warn", text: res.warning }
          : { type: "success", text: "Card removed." }
      );
      await load();
    } else {
      setMsg({ type: "error", text: res.error });
    }
    setBusyId(null);
  }

  async function handleSendLink() {
    setSending(true);
    setMsg(null);
    const res = await sendClientAddCardLink(clientId);
    setMsg(
      res.success
        ? {
            type: "success",
            text: `Add-card link emailed to ${clientEmail}. It expires ${new Date(
              res.expiresAt
            ).toLocaleDateString("en-CA")}.`,
          }
        : { type: "error", text: res.error }
    );
    setSending(false);
  }

  return (
    <div className="dcard">
      <div className="dcard-head">
        <h3>Payment methods</h3>
        {!loading && !synced && (
          <span
            className="pill"
            style={{ background: "#fffbeb", color: "#92400e" }}
            title="Stripe could not be reached — showing the last known cards.">
            <span className="pill-dot" style={{ background: "#d97706" }} />
            Not synced with Stripe
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--primary-60)", margin: 0 }}>
          Loading saved cards…
        </p>
      ) : (
        <>
          {methods.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--primary-50)", margin: "0 0 14px" }}>
              No cards saved. Add one below, or email {clientName.split(" ")[0]} a
              secure link to enter their own card.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {methods.map((pm) => {
                const busy = busyId === pm.id;
                return (
                  <div
                    key={pm.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: pm.isDefault
                        ? "rgba(0,140,156,0.06)"
                        : "rgba(0,140,156,0.03)",
                      border: pm.isDefault
                        ? "1px solid rgba(0,140,156,0.18)"
                        : "1px solid rgba(0,140,156,0.08)",
                      opacity: busy ? 0.6 : 1,
                    }}>
                    <CreditCard
                      size={16}
                      style={{ color: "var(--primary)", flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                          {brandLabel(pm.brand)} •••• {pm.last4 ?? "????"}
                        </span>
                        {pm.isDefault && (
                          <span
                            className="pill"
                            style={{ background: "rgba(0,140,156,0.12)", color: "var(--primary)" }}>
                            <Star
                              size={9}
                              style={{ fill: "var(--primary)", color: "var(--primary)" }}
                            />
                            Default
                          </span>
                        )}
                        {pm.isExpired && (
                          <span
                            className="pill"
                            style={{ background: "#fee2e2", color: "#991b1b" }}>
                            <AlertTriangle size={9} />
                            Expired
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>
                        Expires {expLabel(pm.expMonth, pm.expYear)}
                        {pm.label ? ` · ${pm.label}` : ""}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {!pm.isDefault && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleSetDefault(pm)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "6px 11px",
                            borderRadius: 8,
                            background: "transparent",
                            border: "1px solid rgba(0,140,156,0.2)",
                            color: "var(--primary)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer",
                          }}>
                          <Star size={11} /> Set default
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRemove(pm)}
                        aria-label={`Remove card ending ${pm.last4 ?? ""}`}
                        style={{
                          padding: "6px 9px",
                          borderRadius: 8,
                          background: "transparent",
                          border: "1px solid rgba(220,38,38,0.2)",
                          color: "#dc2626",
                          cursor: busy ? "not-allowed" : "pointer",
                        }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {msg && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                marginBottom: 12,
                background: MSG_STYLE[msg.type].bg,
                color: MSG_STYLE[msg.type].fg,
              }}>
              {msg.text}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                background: "transparent",
                color: "var(--primary)",
                border: "1px dashed rgba(0,140,156,0.3)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
              }}>
              {showAdd ? <X size={13} /> : <Plus size={13} />}
              {showAdd ? "Cancel" : "Add card"}
            </button>

            <button
              type="button"
              onClick={handleSendLink}
              disabled={sending || !clientEmail}
              title={
                clientEmail
                  ? "Email the customer a secure link to add their own card"
                  : "Client has no email on file"
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                background: "transparent",
                color: clientEmail ? "var(--primary-60)" : "var(--primary-40)",
                border: "1px solid rgba(0,140,156,0.15)",
                cursor: !clientEmail || sending ? "not-allowed" : "pointer",
                fontSize: 13,
              }}>
              <Mail size={13} />
              {sending ? "Sending…" : "Email add-card link"}
            </button>
          </div>

          {/* Stripe Elements — the card never touches our server. On success the
              SetupIntent's payment method is attached to the client's Stripe
              customer and picked up by the sync on reload. */}
          {showAdd && (
            <SaveCardOnFile
              clientId={clientId}
              clientName={clientName}
              clientEmail={clientEmail}
              onSaved={async () => {
                setShowAdd(false);
                setMsg({ type: "success", text: "Card saved to file." });
                await load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
