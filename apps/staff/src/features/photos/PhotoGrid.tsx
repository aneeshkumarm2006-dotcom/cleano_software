import type { JobPhoto } from "@bookmops/api/v1";
import { color, radius, space, Text } from "@bookmops/ui-native";
import { Image } from "expo-image";
import { Pressable, useWindowDimensions, View } from "react-native";

import { clockTime, shortDate } from "@/lib/format";

import { localPhotoUri } from "./queue";

const COLUMNS = 3;
const GAP = space[2];

/** Group headings, in the order a job happens. Anything newer files as "Other". */
const GROUPS = [
  { kind: "BEFORE", title: "Before" },
  { kind: "AFTER", title: "After" },
  { kind: "ISSUE", title: "Problems reported" },
  { kind: "GENERAL", title: "Other photos" },
] as const;

const groupOf = (p: JobPhoto) => (p.kind === "UNKNOWN" ? "GENERAL" : p.kind);

/** What a screen reader says for a photo. */
export function describePhoto(p: JobPhoto, timeZone: string): string {
  const kind = GROUPS.find((g) => g.kind === groupOf(p))?.title ?? "Photo";
  const who = p.mine ? "by you" : p.takenBy ? `by ${p.takenBy}` : "from the booking";
  return `${kind} photo, ${who}, ${shortDate(p.takenAt, timeZone)} at ${clockTime(p.takenAt, timeZone)}`;
}

/** The photos on a job, grouped before / after / problems / other, three across. */
export function PhotoGrid({ photos, timeZone, onOpen }: { photos: readonly JobPhoto[]; timeZone: string; onOpen: (photo: JobPhoto) => void }) {
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - space[4] * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  return (
    <View style={{ gap: space[5] }}>
      {GROUPS.map((g) => {
        const list = photos.filter((p) => groupOf(p) === g.kind);
        if (list.length === 0) return null;
        return (
          <View key={g.kind} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
              <Text variant="eyebrow" color="chrome" accessibilityRole="header">
                {g.title}
              </Text>
              <Text variant="small" weight="semibold" color="ink3" numeral>
                {list.length}
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
              {list.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={describePhoto(p, timeZone)}
                  accessibilityHint={p.canDelete ? "Opens the photo. You can delete it there." : "Opens the photo."}
                  onPress={() => onOpen(p)}
                  style={({ pressed }) => ({
                    width: tile,
                    height: tile,
                    borderRadius: radius.md,
                    overflow: "hidden",
                    backgroundColor: color.groundDeep,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Image
                    source={{ uri: localPhotoUri(p.id) ?? p.thumbnailUrl ?? p.url }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    transition={120}
                    recyclingKey={p.id}
                    accessible={false}
                  />
                  {p.mine ? (
                    <View
                      style={{
                        position: "absolute",
                        left: space[1],
                        bottom: space[1],
                        paddingHorizontal: space[2],
                        paddingVertical: 2,
                        borderRadius: radius.pill,
                        backgroundColor: color.scrim,
                      }}
                    >
                      <Text variant="eyebrow" color="onChrome" style={{ fontSize: 9, lineHeight: 12 }}>
                        You
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
