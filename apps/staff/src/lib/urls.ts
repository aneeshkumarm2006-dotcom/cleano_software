/**
 * A link from the server that is safe to hand to the phone's browser or
 * video app: http(s) only, so `javascript:`, `file:`, `intent:` and custom
 * app schemes are never opened. The server sends only http(s) links; this is
 * the app not trusting that. (A regex rather than `new URL`: React Native's URL
 * is a partial implementation.)
 */
export function safeWebUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  return /^https?:\/\/[^\s<>"'\\]+$/i.test(url) ? url : null;
}
