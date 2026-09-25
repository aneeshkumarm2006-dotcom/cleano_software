// Pure string-similarity + duplicate-scoring math. No DB, no server imports —
// the duplicates page renders the score client-side and crm.ts computes it
// server-side, and both must agree to the digit.
//
// Replaces the old `Math.min(98, 58 + matched.length * 13)` in crm.ts, which
// could only ever emit 71 / 84 / 97 / 98 — four values, so the Similarity
// column had nothing to sort and nothing to triage by.

// ── Normalizers (shared with crm.ts's detection pass) ────────────────────────

export function normPhone(p: string | null | undefined): string {
  return (p || "").replace(/\D/g, "");
}

export function normEmail(e: string | null | undefined): string {
  return (e || "").trim().toLowerCase();
}

export function normAddress(a: string | null | undefined): string {
  return (a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normName(n: string | null | undefined): string {
  return (n || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Jaro–Winkler ─────────────────────────────────────────────────────────────

/** Jaro similarity, 0–1. */
export function jaro(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array<boolean>(a.length).fill(false);
  const bHit = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = true;
      bHit[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

/**
 * Jaro–Winkler: Jaro with a bonus for a shared prefix, which is what makes it
 * good at people's names ("Rami" / "Ramy") and bad at nothing we care about.
 */
export function jaroWinkler(a: string, b: string, scale = 0.1): number {
  const j = jaro(a, b);
  if (j < 0.7) return j; // Winkler's own threshold — no bonus for weak matches
  const max = Math.min(4, a.length, b.length);
  let prefix = 0;
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return j + prefix * scale * (1 - j);
}

// ── Per-field similarity ─────────────────────────────────────────────────────
//
// Each returns `null` for "can't tell" (at least one side is blank) rather than
// 0 for "they disagree". The distinction matters: two contacts with no address
// on either record is an absence of evidence, not evidence of difference, and
// scoring it as 0 buried every real duplicate in a sparse dataset.

export function emailSimilarity(a: string | null, b: string | null): number | null {
  const ea = normEmail(a);
  const eb = normEmail(b);
  if (!ea || !eb) return null;
  if (ea === eb) return 1;

  const [la, da] = ea.split("@");
  const [lb, dbm] = eb.split("@");
  if (la && lb && la === lb) return 0.55; // same person, different provider
  if (da && dbm && da === dbm) return Math.min(0.5, jaroWinkler(la ?? "", lb ?? "") * 0.5);
  return jaroWinkler(ea, eb) * 0.35;
}

export function phoneSimilarity(a: string | null, b: string | null): number | null {
  const pa = normPhone(a);
  const pb = normPhone(b);
  if (pa.length < 7 || pb.length < 7) return null;

  // Compare on the last 10 digits so "+1 514…" and "514…" are the same number.
  const ta = pa.slice(-10);
  const tb = pb.slice(-10);
  if (ta === tb) return 1;
  if (pa.slice(-7) === pb.slice(-7)) return 0.7; // same local number, different area code
  return 0;
}

export function nameSimilarity(a: string | null, b: string | null): number | null {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return null;
  if (na === nb) return 1;
  // Token-sorted comparison too, so "Smith John" ≈ "John Smith".
  const sa = na.split(" ").sort().join(" ");
  const sb = nb.split(" ").sort().join(" ");
  return Math.max(jaroWinkler(na, nb), jaroWinkler(sa, sb));
}

export function addressSimilarity(a: string | null, b: string | null): number | null {
  const aa = normAddress(a);
  const ab = normAddress(b);
  if (!aa || !ab) return null;
  if (aa === ab) return 1;
  return jaroWinkler(aa, ab);
}

// ── Weighted pair score ──────────────────────────────────────────────────────

export const SIMILARITY_WEIGHTS = { email: 40, phone: 30, name: 20, address: 10 } as const;
export type SimilarityField = keyof typeof SIMILARITY_WEIGHTS;

/**
 * Credit given to a field neither record fills in. Not 0 (that would punish a
 * sparse record for being sparse) and not 1 (that would invent agreement).
 */
const NO_EVIDENCE = 0.3;

export type ScoredPair = {
  /** 1–99. Never 100: a merge tool should not claim certainty it can't have. */
  score: number;
  /** Fields the two records agree on exactly — drives the "matched on" chips. */
  matched: SimilarityField[];
};

export type ScorableContact = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export function scoreDuplicatePair(a: ScorableContact, b: ScorableContact): ScoredPair {
  const sims: Record<SimilarityField, number | null> = {
    email: emailSimilarity(a.email, b.email),
    phone: phoneSimilarity(a.phone, b.phone),
    name: nameSimilarity(a.name, b.name),
    address: addressSimilarity(a.address, b.address),
  };

  let total = 0;
  const matched: SimilarityField[] = [];
  for (const field of Object.keys(SIMILARITY_WEIGHTS) as SimilarityField[]) {
    const sim = sims[field];
    total += SIMILARITY_WEIGHTS[field] * (sim === null ? NO_EVIDENCE : sim);
    if (sim !== null && sim >= 0.999) matched.push(field);
  }

  return { score: Math.max(1, Math.min(99, Math.round(total))), matched };
}

/**
 * Confidence band for the Similarity badge. High reads as *confident*, so it
 * must not be the error colour — the old scale painted ≥90 red, which told the
 * admin the duplicates we were surest about were the ones that had gone wrong.
 */
export function similarityBand(score: number): "high" | "med" | "low" {
  return score >= 85 ? "high" : score >= 65 ? "med" : "low";
}
