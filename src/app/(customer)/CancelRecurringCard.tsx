"use client";

import { useState } from "react";
import { CalendarX } from "lucide-react";
import { cancelRecurringService } from "./actions/cancelRecurringService";

interface Props {
  frequencyLabel: string;
}

export default function CancelRecurringCard({ frequencyLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { offerSent: boolean }>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await cancelRecurringService({ reason });
    setBusy(false);
    if (res.success) {
      setDone({ offerSent: !!res.offerSent });
    } else {
      setError(res.error ?? "Something went wrong");
    }
  }

  if (done) {
    return (
      <div className="cl-tile cl-tile-pad-lg" style={{ marginTop: 24 }}>
        <h3 className="cl-title" style={{ marginBottom: 8 }}>
          Your recurring service has been cancelled
        </h3>
        <p className="cl-subtitle">
          We&apos;ve stopped your {frequencyLabel.toLowerCase()} schedule.
          {done.offerSent
            ? " Check your inbox — we just sent you a little something in case you'd like to come back."
            : " You can rebook anytime."}
        </p>
      </div>
    );
  }

  return (
    <div className="cl-tile cl-tile-pad-lg" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <CalendarX size={20} style={{ color: "var(--primary-60)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <h3 className="cl-title" style={{ marginBottom: 4 }}>
            Recurring service
          </h3>
          <p className="cl-subtitle" style={{ marginBottom: open ? 16 : 0 }}>
            You&apos;re on a {frequencyLabel.toLowerCase()} schedule. Cancelling stops
            all future recurring visits — individual upcoming cleanings can be
            cancelled separately above.
          </p>

          {open ? (
            <div className="cl-stack-8">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Optional — tell us what went wrong so we can do better"
                style={{
                  width: "100%", borderRadius: 12, padding: "10px 12px",
                  border: "1px solid var(--primary-15, #cbd5e1)", fontSize: 14,
                  resize: "vertical",
                }}
              />
              {error && (
                <p style={{ color: "#b91c1c", fontSize: 13 }}>{error}</p>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="cl-btn cl-btn-primary"
                  style={{ background: "#b91c1c", borderColor: "#b91c1c" }}>
                  {busy ? "Cancelling…" : "Cancel recurring service"}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="cl-link-muted"
                  style={{ background: "none", border: "none", cursor: "pointer" }}>
                  Keep my schedule
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="cl-link"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 10 }}>
              Cancel recurring service →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
