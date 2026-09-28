// Allow-list URL sanitizer. Anything we render as an outbound href, or persist
// as a user-supplied link, must go through this first.
//
// Only absolute http(s) URLs pass. That rejects the schemes that turn a link
// into script execution or local file access — javascript:, data:, vbscript:,
// file:, blob: — so a stored value can never become XSS when rendered in an
// <a href>. Pure + isomorphic: same rule on the server (before write) and in the
// browser (before render).

const MAX_URL_LENGTH = 2048;

/** Returns the normalized absolute http(s) URL, or null if it isn't one. */
export function sanitizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null; // relative/garbage input is rejected, not "fixed up"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}

export function isHttpUrl(raw: unknown): boolean {
  return sanitizeHttpUrl(raw) !== null;
}

/** Hostname for display next to a link ("amazon.ca"). "" when not a valid URL. */
export function urlHost(raw: string): string {
  const safe = sanitizeHttpUrl(raw);
  if (!safe) return "";
  try {
    return new URL(safe).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
