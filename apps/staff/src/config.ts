// Build-time settings for the app. Nothing here is secret: anything shipped in
// an app can be read out of it.
import * as Application from "expo-application";
import { Platform } from "react-native";

/**
 * The platform host, where sign-in finds a person's company. Overridable for
 * development (a local server or staging) with EXPO_PUBLIC_PLATFORM_URL.
 */
export const PLATFORM_URL = process.env.EXPO_PUBLIC_PLATFORM_URL ?? "https://useawer.com";

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
  if (__DEV__ && process.env.EXPO_PUBLIC_DEV_ORIGIN && origin.startsWith(process.env.EXPO_PUBLIC_DEV_ORIGIN)) return true;
  return false;
}
