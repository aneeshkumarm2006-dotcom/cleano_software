// "What's included" service content (item 3). Per web service type: an admin-
// editable text description and an optional graphic (Cloudinary URL), shown on
// the booking page when the customer selects that service. Stored in the
// AppSetting key `content.serviceIncluded` (legacy passthrough — not registry).

export const SERVICE_CONTENT_KEY = "content.serviceIncluded";

export interface ServiceIncludedEntry {
  /** Free-text description of what the service includes. */
  text: string;
  /** Optional Cloudinary URL of a graphic to show alongside the text. */
  imageUrl: string;
}

// Keyed by the booking flow's service-type values (SERVICE_TYPES in
// book/types.ts) so the admin editor and the booking panel line up exactly.
export type ServiceContentConfig = Record<string, ServiceIncludedEntry>;

export const SERVICE_CONTENT_TYPES = [
  "STANDARD",
  "DEEP",
  "MOVE_IN_OUT",
  "POST_CONSTRUCTION",
  "AIRBNB",
] as const;

/** Coerce stored (possibly partial/legacy) data into a full, safe config. */
export function normalizeServiceContent(raw: unknown): ServiceContentConfig {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ServiceContentConfig = {};
  for (const k of SERVICE_CONTENT_TYPES) {
    const e = (stored[k] && typeof stored[k] === "object"
      ? stored[k]
      : {}) as Record<string, unknown>;
    out[k] = {
      text: typeof e.text === "string" ? e.text : "",
      imageUrl: typeof e.imageUrl === "string" ? e.imageUrl : "",
    };
  }
  return out;
}
