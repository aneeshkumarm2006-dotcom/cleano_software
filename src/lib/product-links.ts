// Shared shape + validation for a product's re-order links.
//
// A product has ONE primary `purchaseUrl` (the exact "buy this again" link) and
// any number of extra `ProductLink` rows (label + url). The parsing below is the
// single authority used by BOTH createProduct and updateProduct, so the two
// paths can't validate differently.

import { sanitizeHttpUrl } from "./safe-url";

export interface ProductLinkInput {
  label: string | null;
  url: string;
}

/** Hard caps — reject oversized payloads at the boundary rather than storing them. */
export const MAX_PRODUCT_LINKS = 20;
export const MAX_LINK_LABEL_LENGTH = 100;

/**
 * Parse the JSON `links` field sent by the product form.
 *
 * Reject-by-default: any entry whose URL is not an absolute http(s) URL is
 * dropped, never stored. Returns null (with a reason) when the payload itself is
 * malformed so the caller can surface a validation error instead of silently
 * writing a partial list.
 */
export function parseProductLinks(
  raw: unknown
): { ok: true; links: ProductLinkInput[] } | { ok: false; error: string } {
  if (raw == null || raw === "") return { ok: true, links: [] };
  if (typeof raw !== "string") return { ok: false, error: "Invalid links payload." };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Invalid links payload." };
  }
  if (!Array.isArray(decoded)) return { ok: false, error: "Invalid links payload." };
  if (decoded.length > MAX_PRODUCT_LINKS) {
    return { ok: false, error: `You can add up to ${MAX_PRODUCT_LINKS} links.` };
  }

  const links: ProductLinkInput[] = [];
  for (const entry of decoded) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, url } = entry as { label?: unknown; url?: unknown };

    // Blank rows the user never filled in are ignored, not an error.
    const rawUrl = typeof url === "string" ? url.trim() : "";
    const rawLabel = typeof label === "string" ? label.trim() : "";
    if (!rawUrl && !rawLabel) continue;

    const safeUrl = sanitizeHttpUrl(rawUrl);
    if (!safeUrl) {
      return {
        ok: false,
        error: `"${rawLabel || rawUrl}" is not a valid link. Use a full http:// or https:// URL.`,
      };
    }
    links.push({
      label: rawLabel ? rawLabel.slice(0, MAX_LINK_LABEL_LENGTH) : null,
      url: safeUrl,
    });
  }
  return { ok: true, links };
}
