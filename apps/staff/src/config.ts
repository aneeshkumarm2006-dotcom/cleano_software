// Build-time settings for the app. Nothing here is secret: anything shipped in
// an app can be read out of it.
import * as Application from "expo-application";
import { Platform } from "react-native";

/**
 * The platform host, where sign-in finds a person's company. Passwords go
 * here, so a release build always uses the real one; only a development build
 * can point it elsewhere (a local server or staging) with
 * EXPO_PUBLIC_PLATFORM_URL.
 */
// www, not the apex: the apex answers with a redirect to www, and the app
// refuses redirects on principle (a redirect could carry the session cookie to
// another host).
export const PLATFORM_URL = (__DEV__ && process.env.EXPO_PUBLIC_PLATFORM_URL) || "https://www.useawer.com";

/** "1.0.0 (42)": the native version and build, sent with every call. */
export const APP_VERSION = `${Application.nativeApplicationVersion ?? "0.0.0"} (${Application.nativeBuildVersion ?? "0"})`;

export const PLATFORM: "ios" | "android" = Platform.OS === "android" ? "android" : "ios";

/** The URL scheme the auth server trusts as this app's origin (never as a redirect). */
export const APP_SCHEME = "bookmopspro";

/**
 * The only addresses the app will ever send a password or session to. A
 * company address comes from the server during sign-in; checking it here
 * means a tampered or mistaken response can't send credentials anywhere else.
 */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && /^[a-z0-9-]+\.useawer\.com$/.test(url.hostname)) return true;
  // Development only: a local or staging server named in the build's env.
  // Compared as whole origins: a prefix match would let "localhost:3000.example.com" through.
  if (__DEV__ && process.env.EXPO_PUBLIC_DEV_ORIGIN && url.origin === originOf(process.env.EXPO_PUBLIC_DEV_ORIGIN)) return true;
  return false;
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Hosts whose images the app loads on its own, without a tap: the companies'
 * own addresses and the storage the web uploads to. Loading an image tells
 * its host the phone's address, so a link to anywhere else is shown as a link
 * and only opened when the person chooses to.
 */
const MEDIA_HOST = /^(?:[a-z0-9-]+\.useawer\.com|res\.cloudinary\.com)$/;

export function isTrustedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MEDIA_HOST.test(url.hostname);
  } catch {
    return false;
  }
}
