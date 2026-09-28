// Push notifications: permission, registration, and routing a tap.
//
// Permission is asked for only after the person has seen why (the primer on
// Today), never cold on first launch — a refused prompt can't be asked again
// by the app, only undone in Settings.
import { PushData } from "@bookmops/api/v1";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { secureStorage } from "@/auth/secure-storage";
import { APP_VERSION, PLATFORM } from "@/config";
import type { DataSource } from "@/data/source";

const TOKEN_KEY = "bookmopspro.pushToken";
export const PRIMER_DISMISSED_KEY = "bookmopspro.pushPrimerDismissed";

// While the app is open, a notification shows as a banner rather than
// arriving silently.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushPermission = "granted" | "denied" | "undetermined";

export async function pushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Ask (if not already granted), then register this phone with the server.
 * "unavailable" means this build can't receive pushes at all (no EAS project,
 * as in a local development build).
 */
export async function enablePush(source: DataSource): Promise<PushPermission | "unavailable"> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Jobs and messages",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let status = await pushPermission();
  if (status === "undetermined") {
    const res = await Notifications.requestPermissionsAsync();
    status = res.status === "granted" ? "granted" : "denied";
  }
  if (status !== "granted") return status;

  const id = projectId();
  if (!id) return "unavailable";
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  await source.registerDevice(token, PLATFORM, APP_VERSION);
  secureStorage.setItem(TOKEN_KEY, token);
  return "granted";
}

/** On sign-out: this phone stops receiving this person's notifications. */
export async function disablePush(source: DataSource): Promise<void> {
  const token = secureStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await source.unregisterDevice(token).catch(() => undefined);
  await secureStorage.removeItem(TOKEN_KEY);
}

/**
 * Open the screen a notification points to when it's tapped. Only in-app
 * paths are followed; anything else in the payload is ignored.
 */
export function useNotificationRouting(): void {
  useEffect(() => {
    const open = (data: unknown) => {
      const parsed = PushData.safeParse(data);
      if (parsed.success && parsed.data.path) router.push(parsed.data.path as never);
    };
    // A tap that launched the app from closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, []);
}
