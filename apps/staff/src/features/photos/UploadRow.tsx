import { Button, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import { Image } from "expo-image";
import { View } from "react-native";

import type { UploadItem } from "./queue";

const STEP_TEXT: Record<Exclude<UploadItem["step"], "failed">, string> = {
  waiting: "Waiting to send",
  preparing: "Shrinking the photo",
  sending: "Sending",
  saving: "Saving to the job",
};

/** One photo on its way: where it's got to, and what to do if it failed. */
export function UploadRow({ item, onRetry, onRemove }: { item: UploadItem; onRetry: () => void; onRemove: () => void }) {
  const failed = item.step === "failed";
  const pct = Math.round(item.progress * 100);
  const label =
    item.step === "failed"
      ? (item.error ?? "Didn't send")
      : item.step === "sending"
        ? `${STEP_TEXT.sending} ${pct}%`
        : STEP_TEXT[item.step];
  const phase = item.phase === "AFTER" ? "After" : "Before";

  return (
    <View
      accessible={!failed}
      accessibilityLabel={`${phase} photo. ${label}`}
      accessibilityLiveRegion={failed ? "polite" : "none"}
      style={{
        flexDirection: "row",
        gap: space[3],
        padding: space[3],
        borderRadius: radius.lg,
        backgroundColor: failed ? color.dangerSoft : color.surface,
        borderWidth: 1,
        borderColor: failed ? color.dangerSoft : color.line,
      }}
    >
      <Image
        source={{ uri: item.previewUri }}
        style={{ width: 56, height: 56, borderRadius: radius.sm, backgroundColor: color.groundDeep }}
        contentFit="cover"
        accessible={false}
      />
      <View style={{ flex: 1, gap: space[2], justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          {failed ? <Icon name="warning" size={16} color="danger" /> : null}
          <Text variant="eyebrow" color={failed ? "danger" : "ink3"}>
            {phase}
          </Text>
        </View>
        <Text variant="small" color={failed ? "danger" : "ink2"} numeral numberOfLines={2}>
          {label}
        </Text>
        {!failed ? (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: color.groundDeep, overflow: "hidden" }}>
            <View
              style={{
                width: `${item.step === "saving" ? 100 : item.step === "sending" ? Math.max(4, pct) : 4}%`,
                height: "100%",
                backgroundColor: color.accent,
              }}
            />
          </View>
        ) : (
          <View style={{ flexDirection: "row", gap: space[2] }}>
            {item.canRetry ? <Button label="Try again" icon="retry" variant="secondary" size="md" onPress={onRetry} style={{ flex: 1 }} /> : null}
            <Button label="Remove" variant="secondary" size="md" onPress={onRemove} style={{ flex: item.canRetry ? 0 : 1 }} />
          </View>
        )}
      </View>
    </View>
  );
}
