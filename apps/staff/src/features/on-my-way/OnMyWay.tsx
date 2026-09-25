// "On my way": tell the office, and the client, that you're heading to
// today's job. Shown only before clock-in on today's job (in the company's
// timezone); the server checks the same and has the final say.
//
// Location is asked for only when the button is tapped, only in the
// foreground, and only when the company keeps a location with it. The person
// is told why before the phone asks, and it sends either way.
import { ApiError } from "@bookmops/api/client";
import type { JobSummary } from "@bookmops/api/v1";
import { Button, Icon, space, Text } from "@bookmops/ui-native";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRef, useState } from "react";
import { Alert, type StyleProp, View, type ViewStyle } from "react-native";

import { useMarkOnMyWay, useOnMyWayState } from "@/data/queries";
import { clockTime, localDateKey } from "@/lib/format";
import { useNow } from "@/lib/use-now";

/** How long to wait for a position before sending without one. */
const LOCATE_TIMEOUT_MS = 8_000;
/** When the phone gives no accuracy estimate, say "about 5 km" rather than claim precision. */
const UNKNOWN_ACCURACY_M = 5_000;

const OPEN_STATUSES = new Set(["CREATED", "SCHEDULED", "IN_PROGRESS"]);

/** Before this cleaner's clock-in, on a job that is today in the company's zone. */
export function canSayOnMyWay(job: Pick<JobSummary, "startsAt" | "status" | "clock">, now: Date, timeZone: string): boolean {
  return (
    job.clock.state === "NOT_STARTED" &&
    OPEN_STATUSES.has(job.status) &&
    localDateKey(job.startsAt, timeZone) === localDateKey(now.toISOString(), timeZone)
  );
}

export function OnMyWay({
  job,
  timeZone,
  tone,
  clientName,
  style,
}: {
  job: Pick<JobSummary, "id" | "startsAt" | "status" | "clock">;
  timeZone: string;
  /** `light` on the job screen; `chrome` inside the dark next-job card. */
  tone: "light" | "chrome";
  /** The client's first name, when the screen has it, for the confirmation. */
  clientName?: string | null;
  /** Spacing from what's above; applied only when there's something to show. */
  style?: StyleProp<ViewStyle>;
}) {
  const now = useNow(60_000);
  const eligible = canSayOnMyWay(job, now, timeZone);
  const state = useOnMyWayState(job.id, eligible);
  const mark = useMarkOnMyWay(job.id);
  const [locating, setLocating] = useState(false);
  // One tap, one event: a retry after a dropped connection reuses it.
  const eventId = useRef<string | null>(null);

  if (!eligible || state.isPending) return null;

  const chrome = tone === "chrome";
  const sentAt = mark.data?.sentAt ?? state.data?.sentAt ?? null;

  if (sentAt) {
    const told = mark.data && !mark.data.alreadySent ? toldLine(mark.data.clientTold, clientName) : null;
    return (
      <View accessibilityLiveRegion="polite" style={[{ gap: space[1] }, style]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
          <Icon name="check" size={20} color={chrome ? "successOnChrome" : "success"} />
          <Text variant="bodyStrong" color={chrome ? "onChrome" : "ink"} numeral>
            On your way · told at {clockTime(sentAt, timeZone)}
          </Text>
        </View>
        {told ? (
          <Text variant="small" color={chrome ? "onChrome2" : "ink2"}>
            {told}
          </Text>
        ) : null}
      </View>
    );
  }

  const askForLocation = state.data?.askForLocation ?? false;
  const busy = locating || mark.isPending;

  async function confirm() {
    if (busy) return;
    const perm = askForLocation ? await Location.getForegroundPermissionsAsync().catch(() => null) : null;
    const phoneWillAsk = !!perm && !perm.granted && perm.canAskAgain;
    const who = clientName ?? "the client";
    Alert.alert(
      "Tell them you're on your way?",
      `The office and ${who} will know you're heading over.` +
        (phoneWillAsk
          ? "\n\nYour phone will then ask to share your location once, so the office can see how far away you are. You can say no; it still sends."
          : ""),
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", onPress: () => void send(perm) },
      ],
    );
  }

  async function send(perm: Location.LocationPermissionResponse | null) {
    let coords: { lat: number; lng: number; accuracyM: number } | undefined;
    if (askForLocation && perm) {
      setLocating(true);
      coords = await locateOnce(perm);
      setLocating(false);
    }
    eventId.current ??= randomUUID();
    mark.mutate(
      { coords, clientEventId: eventId.current },
      { onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) },
    );
  }

  const error = mark.error ? (mark.error instanceof ApiError ? mark.error.message : "It didn't send. Check your signal and try again.") : null;

  return (
    <View style={[{ gap: space[2] }, style]}>
      <Button
        label={locating ? "Finding you…" : error ? "Try again" : "On my way"}
        icon="onMyWay"
        variant={chrome ? "ghostOnChrome" : "secondary"}
        size={chrome ? "md" : "lg"}
        loading={mark.isPending}
        disabled={locating}
        accessibilityHint={`Tells the office and ${clientName ?? "the client"} you're heading to this job`}
        onPress={() => void confirm()}
      />
      {error ? (
        <Text variant="small" color={chrome ? "warningOnChrome" : "danger"} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function toldLine(clientTold: boolean, clientName?: string | null): string {
  return clientTold ? `The office knows, and ${clientName ?? "the client"} got a text.` : "The office knows.";
}

/** One position, if the person allows it. Never throws; never blocks sending. */
async function locateOnce(perm: Location.LocationPermissionResponse): Promise<{ lat: number; lng: number; accuracyM: number } | undefined> {
  try {
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) granted = (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return undefined;
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATE_TIMEOUT_MS)),
    ]);
    const pos = fresh ?? (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 1_000 }));
    if (!pos) return undefined;
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: Math.min(100_000, Math.round(pos.coords.accuracy ?? UNKNOWN_ACCURACY_M)),
    };
  } catch {
    return undefined;
  }
}
