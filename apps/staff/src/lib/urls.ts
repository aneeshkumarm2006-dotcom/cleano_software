/**
 * A link from the server that is safe to hand to the phone's browser or
 * video app: https only, so `javascript:`, `file:`, `intent:`, custom app
 * schemes and plain http (which anyone on the same wifi can read or swap)
 * are never opened. The server sends only https links; this is the app not
 * trusting that. (A regex rather than `new URL`: React Native's URL is a
 * partial implementation.)
 */
export function safeWebUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  return /^https:\/\/[^\s<>"'\\]+$/i.test(url) ? url : null;
}
