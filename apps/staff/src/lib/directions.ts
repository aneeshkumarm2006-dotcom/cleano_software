import { Linking, Platform } from "react-native";

/**
 * Open turn-by-turn directions to an address in the phone's own maps app:
 * Apple Maps on iOS, whatever handles `geo:` on Android (Google Maps, usually).
 * Falls back to Google Maps on the web if neither can open.
 */
export async function openDirections(address: string): Promise<void> {
  const q = encodeURIComponent(address);
  const native = Platform.select({ ios: `maps://?daddr=${q}`, android: `geo:0,0?q=${q}` });
  const web = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  try {
    if (native && (await Linking.canOpenURL(native))) {
      await Linking.openURL(native);
      return;
    }
  } catch {
    // Fall through to the web link.
  }
  await Linking.openURL(web);
}

/** The address as one line, for maps and for screen readers. */
export function addressLine(a: { line1: string; line2: string | null; area: string | null }): string {
  return [a.line1, a.line2, a.area].filter(Boolean).join(", ");
}
