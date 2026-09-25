import { MESSAGE_BODY_MAX } from "@bookmops/api/v1";
import { color, fontFamily, Icon, radius, space, Text } from "@bookmops/ui-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

/** Past this many characters the count shows, so the limit is never a surprise. */
const COUNT_FROM = MESSAGE_BODY_MAX - 500;

/**
 * Where a message is written. Grows with the text up to a few lines, then
 * scrolls. Send stays disabled until there is something to send. The limit is
 * the web's, so a message typed here is never one the server refuses for
 * length.
 */
export function Composer({
  placeholder,
  onSend,
  bottomPadding,
}: {
  /** Also its accessible name: "Message the office". */
  placeholder: string;
  /** Returns false if the message couldn't be taken (then the draft stays). */
  onSend: (text: string) => boolean;
  bottomPadding: number;
}) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0;
  const length = draft.trim().length;

  function send() {
    if (!canSend) return;
    if (onSend(draft)) setDraft("");
  }

  return (
    <View
      style={{
        paddingHorizontal: space[4],
        paddingTop: space[3],
        paddingBottom: bottomPadding,
        backgroundColor: color.surface,
        borderTopWidth: 1,
        borderTopColor: color.line,
        gap: space[1],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] + 1 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={color.ink3}
          accessibilityLabel={placeholder}
          multiline
          maxLength={MESSAGE_BODY_MAX}
          autoCapitalize="sentences"
          autoCorrect
          textAlignVertical="center"
          style={{
            flex: 1,
            minHeight: 46,
            maxHeight: 132,
            paddingHorizontal: space[4],
            paddingTop: space[3],
            paddingBottom: space[3],
            borderRadius: 14,
            backgroundColor: color.ground,
            fontFamily: fontFamily.medium,
            fontSize: 15.5,
            lineHeight: 21,
            color: color.ink,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 46,
            height: 46,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? (pressed ? color.chrome : color.accent) : color.groundDeep,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <Icon name="send" size={20} color={canSend ? "onChrome" : "ink3"} />
        </Pressable>
      </View>
      {length >= COUNT_FROM ? (
        <Text
          variant="small"
          numeral
          color={length >= MESSAGE_BODY_MAX ? "danger" : "ink3"}
          accessibilityLiveRegion="polite"
          style={{ paddingHorizontal: space[1], borderRadius: radius.sm }}
        >
          {length} / {MESSAGE_BODY_MAX}
        </Text>
      ) : null}
    </View>
  );
}
