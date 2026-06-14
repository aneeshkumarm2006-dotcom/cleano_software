// Canonical avatar helpers — ported from the Cleano design handoff.
// Consolidates the ~6 divergent `avatarColor` copies scattered across admin
// pages into one deterministic, token-aligned palette so the same person gets
// the same color everywhere.

const AV_PALETTE = [
  "#005F6A",
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
