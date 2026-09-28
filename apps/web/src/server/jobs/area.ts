// A job's neighbourhood or city, and nothing finer: what a cleaner may see
// before a job is theirs, and what a pay line shows to recognise a job.
// Never the street, the unit or the postal code.
import "server-only";

/**
 * Coarse area from a one-line address ("123 Rue Sainte-Catherine, Montreal,
 * QC H2X 1Y4" → "Montreal"). Purely a scanning aid: an unparseable address
 * has no area. Moved here unchanged from the available-jobs page.
 */
export function deriveArea(location: string | null): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const area = parts[1].replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i, "").trim();
  return area || null;
}

/** The saved address's city when there is one, else the area parsed from the line. */
export function jobArea(job: { location: string | null; clientAddress?: { city: string | null } | null }): string | null {
  const city = job.clientAddress?.city?.trim();
  return city || deriveArea(job.location);
}
