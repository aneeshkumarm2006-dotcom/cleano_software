// Reading the session cookie ourselves, for the one case better-auth can't
// answer: telling "no session" apart from "a switched-off account".
//
// `customSession` (lib/auth.ts) turns an inactive or deleted person's session
// into no session at all, which is right for every web page. But the phone's
// offline queue treats the two differently (API_V1.md §6): signed out means
// "sign in again", ACCOUNT_INACTIVE means "stop and say why". So when
// better-auth says "no session", the v1 wrapper looks the token up directly
// and, only if it belongs to a switched-off person in THIS company, answers
// 403 ACCOUNT_INACTIVE instead of 401.
//
// The cookie is verified exactly as better-call signs it (HMAC-SHA256 over the
// token with the auth secret, base64). An unsigned or forged value is ignored.
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAMES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

function cookieValue(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** The verified session token from a Cookie header, or null. */
export function verifiedSessionToken(cookieHeader: string | null, secret: string | undefined): string | null {
  if (!cookieHeader || !secret) return null;
  for (const name of COOKIE_NAMES) {
    const raw = cookieValue(cookieHeader, name);
    if (!raw) continue;
    let value: string;
    try {
      value = decodeURIComponent(raw);
    } catch {
      continue;
    }
    const dot = value.lastIndexOf(".");
    if (dot < 1) continue;
    const token = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    if (signature.length !== 44 || !signature.endsWith("=")) continue;
    const expected = createHmac("sha256", secret).update(token).digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return token;
  }
  return null;
}
