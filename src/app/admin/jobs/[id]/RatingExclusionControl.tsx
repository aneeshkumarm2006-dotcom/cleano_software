"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { setRatingExcluded } from "../../actions/setRatingExcluded";

/**
 * Remove a star rating from a cleaner's score, or put it back
 * (AwerNewFixes.pdf item 5).
 *
 * Excluding asks for a reason — the record of WHY a rating was pulled is the
 * point of keeping the row. Restoring is a single click.
 */

const PRESET_REASONS = [
  "Test job",
  "Cancelled job",
  "Incorrect rating",
  "Complaint resolved in cleaner's favour",
  "Rating not about this cleaner",
];

export default function RatingExclusionControl({
  ratingId,
  excluded,
}: {
  ratingId: string;
  excluded: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState("");

  const submit = async (nextExcluded: boolean) => {
    setBusy(true);
    setError(null);
    const result = await setRatingExcluded({
      ratingId,
      excluded: nextExcluded,
      reason: nextExcluded
        ? reason === "Other"
          ? customReason.trim()
          : reason
        : undefined,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  const linkStyle = {
    fontSize: 11.5,
    fontWeight: 600,
    background: "none",
    border: 0,
    padding: 0,
    cursor: busy ? "default" : "pointer",
  } as const;

  if (excluded) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => submit(false)}
        style={{ ...linkStyle, color: "var(--primary)" }}>
        {busy ? "Restoring…" : "Restore rating"}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason(PRESET_REASONS[0]);
          setCustomReason("");
          setError(null);
          setOpen(true);
        }}
        style={{ ...linkStyle, color: "#b91c1c" }}>
        Exclude rating
      </button>

      <Modal
        isOpen={open}
        onClose={() => !busy && setOpen(false)}
        title="Exclude this rating"
        subheader="The rating stays on the job for review, but stops counting toward the cleaner's average and pay tier.">
        <div style={{ padding: 24, display: "grid", gap: 16 }}>
          <div>
            <label className="label">Reason</label>
            <select
              className="input"
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}>
              {PRESET_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value="Other">Other…</option>
            </select>
          </div>

          {reason === "Other" && (
            <div>
              <label className="label">Details</label>
              <input
                className="input"
                value={customReason}
                disabled={busy}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Why is this rating being excluded?"
              />
            </div>
          )}

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 13,
                color: "#b91c1c",
              }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => submit(true)}
              disabled={busy || (reason === "Other" && !customReason.trim())}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {busy ? (
                <>
                  <Loader size={14} className="animate-spin" /> Excluding…
                </>
              ) : (
                "Exclude rating"
              )}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
