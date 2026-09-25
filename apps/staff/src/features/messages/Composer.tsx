import { MESSAGE_BODY_MAX } from "@bookmops/api/v1";
import { color, fontFamily, Icon, radius, space, Text } from "@bookmops/ui-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

/** Past this many characters the count shows, so the limit is never a surprise. */
const COUNT_FROM = MESSAGE_BODY_MAX - 500;

/** A message being edited in the composer. */
export interface ComposerEdit {
  /** Which message: a change of key starts a new edit. */
  key: string;
  body: string;
}

/**
 * Where a message is written. Grows with the text up to a few lines, then
 * scrolls. Send stays disabled until there is something to send. The limit is
 * the web's, so a message typed here is never one the server refuses for
 * length.
 *
 * Editing: given `editing`, it holds that message's text under an "Editing
 * message" bar with a way out. Whatever was being typed before is put back
 * when the edit is saved or cancelled.
 */
export function Composer({
  placeholder,
  onSend,
  bottomPadding,
  editing = null,
  onSaveEdit,
  onCancelEdit,
}: {
  /** Also its accessible name: "Message the office". */
  placeholder: string;
  /** Returns false if the message couldn't be taken (then the draft stays). */
  onSend: (text: string) => boolean;
  bottomPadding: number;
  editing?: ComposerEdit | null;
  onSaveEdit?: (text: string) => void;
  onCancelEdit?: () => void;
}) {
  const [draft, setDraft] = useState("");
  // The unsent draft, kept while an edit borrows the box.
  const [kept, setKept] = useState("");
  const [shownEdit, setShownEdit] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const editKey = editing?.key ?? null;

  // Starting, switching or ending an edit swaps what's in the box. Done while
  // rendering, so the old text never flashes up first.
  if (editKey !== shownEdit) {
    setShownEdit(editKey);
    if (editing) {
      if (shownEdit === null) setKept(draft);
      setDraft(editing.body);
    } else {
      setDraft(kept);
      setKept("");
    }
  }

  useEffect(() => {
    if (editKey) input.current?.focus();
  }, [editKey]);

  const canSend = draft.trim().length > 0;
  const length = draft.trim().length;

  function send() {
    if (!canSend) return;
    if (editing) {
      onSaveEdit?.(draft);
      return;
    }
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
      {editing ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: space[1] }}>
          <Icon name="compose" size={16} color="accentText" />
          <Text variant="small" weight="semibold" color="accentText" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
            Editing message
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            onPress={onCancelEdit}
            hitSlop={8}
            style={({ pressed }) => ({
              minHeight: 32,
              flexDirection: "row",
              alignItems: "center",
              gap: space[1],
              paddingHorizontal: space[2],
              borderRadius: radius.sm,
              backgroundColor: pressed ? color.groundDeep : "transparent",
            })}
          >
            <Icon name="close" size={16} color="ink2" />
            <Text variant="small" weight="semibold" color="ink2">
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] + 1 }}>
        <TextInput
          ref={input}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={color.ink3}
          accessibilityLabel={editing ? "Edit your message" : placeholder}
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
          accessibilityLabel={editing ? "Save edit" : "Send"}
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
          <Icon name={editing ? "tick" : "send"} size={20} color={canSend ? "onChrome" : "ink3"} />
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
