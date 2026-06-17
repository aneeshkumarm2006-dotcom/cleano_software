"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import { submitCustomerRating, type PendingRatingJob } from "./actions/ratingActions";

interface Props {
  pending: PendingRatingJob;
}

export default function RatingPopup({ pending }: Props) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function handleSubmit() {
    if (stars === 0) return;
    setSubmitting(true);
    await submitCustomerRating(pending.token, stars, false);
    setDismissed(true);
  }

  async function handleSkip() {
    setSubmitting(true);
    await submitCustomerRating(pending.token, 0, true);
    setDismissed(true);
  }

  const displayStars = hovered || stars;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}>
      <div
        style={{
          background: "#fff",
          borderRadius: 20,
          padding: "32px 28px",
          maxWidth: 400,
          width: "100%",
          position: "relative",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        }}>
        <button
          onClick={handleSkip}
          disabled={submitting}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#999",
            padding: 4,
          }}
          aria-label="Dismiss">
          <X size={18} />
        </button>

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(245,194,0,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}>
            <Star size={28} style={{ color: "#f5c200", fill: "#f5c200" }} />
          </div>

          <h2
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#111",
              margin: "0 0 6px",
            }}>
            How was your cleaning?
          </h2>
          <p style={{ fontSize: 14, color: "#666", margin: "0 0 24px" }}>
            Rate your cleaner <strong>{pending.cleanerName}</strong> from job #{pending.jobNumber}
          </p>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              marginBottom: 24,
            }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onMouseEnter={() => setHovered(s)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setStars(s)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  transition: "transform 0.1s",
                  transform: displayStars >= s ? "scale(1.15)" : "scale(1)",
                }}
                aria-label={`${s} star`}>
                <Star
                  size={36}
                  style={{
                    color: displayStars >= s ? "#f5c200" : "#e0e0e0",
                    fill: displayStars >= s ? "#f5c200" : "#e0e0e0",
                    transition: "color 0.15s, fill 0.15s",
                  }}
                />
              </button>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={stars === 0 || submitting}
            style={{
              width: "100%",
              padding: "13px 0",
              background: stars > 0 ? "#008C9C" : "#e0e0e0",
              color: stars > 0 ? "#fff" : "#aaa",
              border: "none",
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              cursor: stars > 0 ? "pointer" : "not-allowed",
              marginBottom: 10,
              transition: "background 0.15s",
            }}>
            {submitting ? "Submitting…" : "Submit Rating"}
          </button>

          <button
            onClick={handleSkip}
            disabled={submitting}
            style={{
              background: "none",
              border: "none",
              fontSize: 13,
              color: "#999",
              cursor: "pointer",
              padding: "4px 8px",
            }}>
            Rather not answer
          </button>
        </div>
      </div>
    </div>
  );
}
