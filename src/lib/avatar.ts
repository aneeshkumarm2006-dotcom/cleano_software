// Canonical avatar helpers — ported from the Cleano design handoff.
// Consolidates the ~6 divergent `avatarColor` copies scattered across admin
// pages into one deterministic, token-aligned palette so the same person gets
// the same color everywhere.

const AV_PALETTE = [
  "#008C9C",
  "#0d7a86",
  "#1f7a5e",
  "#9a6a2f",
  "#8a4a55",
  "#5b5fb0",
  "#2f6fae",
  "#7a5ca0",
];

/** Deterministic color for a name — same input always maps to the same swatch. */
export function avatarColor(name: string): string {
  let h = 0;
  const s = name || "";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AV_PALETTE[Math.abs(h) % AV_PALETTE.length];
}

/**
 * A name shortened for tight spaces: "Premsai Kilaru" → "Premsai K."
 *
 * The calendar month view previously did `name.split(" ")[0]`, which threw the
 * surname away entirely — two clients called "David" were indistinguishable on
 * the card (awer_fixes.pdf item 28, "client name, shortened if needed").
 * Single-word names are returned as-is.
 */
export function shortName(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last[0].toUpperCase()}.`;
}

/** Up to two uppercase initials from a name. */
export function initials(name: string): string {
  return (name || "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
