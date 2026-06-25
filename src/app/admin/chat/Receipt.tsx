"use client";

import type { DeliveryState } from "./types";

interface ReceiptProps {
  state: DeliveryState;
  // Tint colour — typically inherited from the bubble.
  color?: string;
}

/**
 * WhatsApp-style delivery receipt:
 *  - SENT       → single tick (✓)
 *  - DELIVERED  → double tick (✓✓)
 *  - READ       → eye icon (👁)
 */
export default function Receipt({ state, color }: ReceiptProps) {
  const stroke = color ?? "currentColor";

  if (state === "READ") {
    // Eye glyph — slightly larger so it reads as the "seen" state.
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.95 }} aria-label="Seen">
        <path
          d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
          stroke={stroke}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" stroke={stroke} strokeWidth="1.8" />
      </svg>
    );
  }

  if (state === "DELIVERED") {
    // Two overlapping ticks
    return (
      <svg width="14" height="9" viewBox="0 0 14 9" fill="none" style={{ opacity: 0.8 }} aria-label="Delivered">
        <path d="M1 4.5l2.4 2.4L7.8 2.4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 4.5l2.4 2.4 5-5.4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // SENT
  return (
    <svg width="11" height="8" viewBox="0 0 11 8" fill="none" style={{ opacity: 0.7 }} aria-label="Sent">
      <path d="M1 4l2.5 2.5L6 4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
