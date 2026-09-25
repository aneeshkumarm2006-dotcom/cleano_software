import type { JobPhoto } from "@bookmops/api/v1";
import { Button, color, IconButton, space, Text } from "@bookmops/ui-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { Modal, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clockTime, shortDate } from "@/lib/format";

import { describePhoto } from "./PhotoGrid";
import { localPhotoUri } from "./queue";

/** One photo, full screen, on the dark chrome; delete it from here if it's yours. */
export function PhotoViewer({
  photo,
  timeZone,
  deleting,
  onClose,
  onDelete,
}: {
  photo: JobPhoto | null;
  timeZone: string;
  deleting: boolean;
  onClose: () => void;
  onDelete: (photo: JobPhoto) => void;
}) {
  const insets = useSafeAreaInsets();
  const who = photo ? (photo.mine ? "You" : (photo.takenBy ?? "From the booking")) : "";

  return (
    <Modal visible={!!photo} animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={["portrait"]}>
      <StatusBar style="light" />
      {photo ? (
        <View style={{ flex: 1, backgroundColor: color.chrome, paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[4] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4] }}>
            <IconButton icon="close" label="Close photo" tone="onChrome" onPress={onClose} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" color="onChrome" numberOfLines={1}>
                {who}
              </Text>
              <Text variant="small" color="onChrome3" numeral>
                {shortDate(photo.takenAt, timeZone)} · {clockTime(photo.takenAt, timeZone)}
              </Text>
            </View>
          </View>

          <Image
            source={{ uri: localPhotoUri(photo.id) ?? photo.url }}
            placeholder={photo.thumbnailUrl ? { uri: photo.thumbnailUrl } : undefined}
            style={{ flex: 1, marginVertical: space[4] }}
            contentFit="contain"
            transition={150}
            accessible
            accessibilityLabel={describePhoto(photo, timeZone)}
          />

          {photo.caption ? (
            <Text variant="body" color="onChrome2" style={{ paddingHorizontal: space[4], marginBottom: space[3] }}>
              {photo.caption}
            </Text>
          ) : null}

          <View style={{ paddingHorizontal: space[4] }}>
            {photo.canDelete ? (
              <Button label="Delete photo" icon="trash" variant="ghostOnChrome" loading={deleting} onPress={() => onDelete(photo)} />
            ) : (
              <Text variant="small" color="onChrome3" align="center">
                {photo.takenBy ? "Only the person who took a photo can delete it." : "The client added this when booking."}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
