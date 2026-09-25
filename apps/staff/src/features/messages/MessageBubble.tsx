import type { MessageAttachment } from "@bookmops/api/v1";
import { color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { Image } from "expo-image";
import { type AccessibilityActionEvent, Linking, Pressable, View } from "react-native";

import { isTrustedMediaUrl } from "@/config";
import { clockTime, initials } from "@/lib/format";

import { safeHttpsUrl, type MessageStatus, type ThreadMessage } from "./thread";

const BUBBLE_MAX = "80%";

const STATUS_TEXT: Record<MessageStatus, string> = {
  sending: "Sending…",
  failed: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
};

/** A small round badge with someone's initials. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color.accent, alignItems: "center", justifyContent: "center" }}
    >
      <Text variant="eyebrow" color="onChrome" style={{ fontSize: size * 0.36, lineHeight: size * 0.46, letterSpacing: 0 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

const OWN_ACTIONS = [
  { name: "edit", label: "Edit" },
  { name: "delete", label: "Delete" },
];

const MODERATE_ACTIONS = [{ name: "remove", label: "Remove message" }];

/** Team chat moderation: removing someone else's message (OWNER, ADMIN, OPS_MANAGER). */
export interface ModerationActions {
  onRemove: (message: ThreadMessage) => void;
}

/** What can be done with one of the person's own sent messages. */
export interface OwnMessageActions {
  /** Long press: offer Edit and Delete. */
  onOptions: (message: ThreadMessage) => void;
  onEdit: (message: ThreadMessage) => void;
  onDelete: (message: ThreadMessage) => void;
}

/**
 * One message. The person's own are filled with the dark chrome on the right;
 * everyone else's are quiet white cards on the left, with who sent them.
 * Importance and ownership are fill, never a coloured stripe.
 *
 * A message the person may change (`editableId`) opens Edit and Delete on a
 * long press, and offers the same two as accessibility actions. A deleted
 * message keeps its place as an italic "Message deleted".
 */
export function MessageBubble({
  message,
  showName,
  namesAbove,
  timeZone,
  onFailedPress,
  own,
  moderate,
}: {
  message: ThreadMessage;
  /** Team chat: the sender's name over the first of their run of messages. */
  showName: boolean;
  /** The conversation puts names above bubbles (team), not beside the time (office). */
  namesAbove: boolean;
  timeZone: string;
  onFailedPress: (message: ThreadMessage) => void;
  /** Team chat only: editing and deleting the person's own messages. */
  own?: OwnMessageActions;
  /** Team chat, for the office: removing anyone else's message. */
  moderate?: ModerationActions;
}) {
  const { mine, deleted } = message;
  const time = clockTime(message.createdAt, timeZone);
  const failed = message.status === "failed";
  const status = mine && message.status && !deleted ? STATUS_TEXT[message.status] : null;
  const edited = !deleted && message.editedAt ? "edited" : null;
  const text = deleted ? "Message deleted" : message.body;
  const spoken = `${mine ? "You" : message.senderName}, ${time}${edited ? ", edited" : ""}${status ? `, ${status}` : ""}. ${text}`;
  const actions = own && message.editableId && !deleted ? own : null;
  const removable = !actions && moderate && message.removableId && !deleted && !mine ? moderate : null;

  const bubbleStyle = {
    paddingHorizontal: space[4] - 2,
    paddingVertical: space[3],
    backgroundColor: deleted ? "transparent" : mine ? color.chrome : color.surface,
    borderWidth: mine && !deleted ? 0 : 1,
    borderColor: color.line,
    borderRadius: 16,
    borderBottomRightRadius: mine ? 5 : 16,
    borderBottomLeftRadius: mine ? 16 : 5,
    opacity: failed ? 0.72 : 1,
  } as const;

  const content = deleted ? (
    <Text variant="body" color="ink3" style={{ fontStyle: "italic" }}>
      Message deleted
    </Text>
  ) : (
    // Selecting text would take the long press, so a message with actions isn't selectable.
    <Text variant="body" color={mine ? "onChrome" : "ink"} selectable={!actions && !removable}>
      {message.body}
    </Text>
  );

  const bubble = !text ? null : actions ? (
    <Pressable
      accessible
      accessibilityLabel={spoken}
      accessibilityActions={OWN_ACTIONS}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === "edit") actions.onEdit(message);
        else if (e.nativeEvent.actionName === "delete") actions.onDelete(message);
      }}
      onLongPress={() => actions.onOptions(message)}
      style={({ pressed }) => [bubbleStyle, pressed ? { opacity: 0.8 } : null]}
    >
      {content}
    </Pressable>
  ) : removable ? (
    <Pressable
      accessible
      accessibilityLabel={spoken}
      accessibilityHint="Long press to remove it"
      accessibilityActions={MODERATE_ACTIONS}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        if (e.nativeEvent.actionName === "remove") removable.onRemove(message);
      }}
      onLongPress={() => removable.onRemove(message)}
      style={({ pressed }) => [bubbleStyle, pressed ? { opacity: 0.8 } : null]}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={spoken} style={bubbleStyle}>
      {content}
    </View>
  );

  const meta = failed ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Message not sent. Try again or delete it."
      onPress={() => onFailedPress(message)}
      hitSlop={6}
      style={{ minHeight: minTouch, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space[1] }}
    >
      <Icon name="retry" size={18} color="danger" />
      <Text variant="small" weight="semibold" color="danger">
        Not sent · Tap to try again
      </Text>
    </Pressable>
  ) : (
    <Text
      variant="small"
      color="ink3"
      numeral
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={{ fontSize: 11.5, lineHeight: 15, paddingHorizontal: space[1], textAlign: mine ? "right" : "left" }}
    >
      {mine
        ? [time, edited, status].filter(Boolean).join(" · ")
        : [namesAbove ? null : message.senderName, time, edited].filter(Boolean).join(" · ")}
    </Text>
  );

  const column = (
    <View style={{ maxWidth: BUBBLE_MAX, gap: space[1] + 1, alignItems: mine ? "flex-end" : "flex-start" }}>
      {showName ? (
        <Text variant="small" weight="bold" color="accentText" style={{ paddingHorizontal: space[1] }} importantForAccessibility="no">
          {message.senderName}
        </Text>
      ) : null}
      {bubble}
      {message.attachment && !deleted ? <Attachment attachment={message.attachment} mine={mine} /> : null}
      {meta}
    </View>
  );

  if (mine) return <View style={{ alignItems: "flex-end" }}>{column}</View>;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] + 1 }}>
      <View style={{ paddingBottom: 20 }}>
        <Avatar name={message.senderName} />
      </View>
      {column}
    </View>
  );
}

/** A photo or a file sent with a message. Opened in the browser, https only. */
function Attachment({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const url = safeHttpsUrl(attachment.url);
  const open = () => {
    if (url) void Linking.openURL(url).catch(() => {});
  };

  // Shown inline only from our own storage; any other link waits for a tap.
  if (attachment.kind === "IMAGE" && url && isTrustedMediaUrl(url)) {
    return (
      <Pressable accessibilityRole="link" accessibilityLabel="Photo. Opens full size." onPress={open}>
        <Image
          source={{ uri: url }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
          style={{ width: 220, height: 165, borderRadius: 14, backgroundColor: color.groundDeep }}
        />
      </Pressable>
    );
  }

  const label = attachment.name ?? (attachment.kind === "IMAGE" ? "Photo" : "Attachment");
  return (
    <Pressable
      accessibilityRole={url ? "link" : undefined}
      accessibilityLabel={url ? `${label}. Opens in the browser.` : `${label}, can't be opened`}
      disabled={!url}
      onPress={open}
      style={({ pressed }) => ({
        minHeight: minTouch + 4,
        flexDirection: "row",
        alignItems: "center",
        gap: space[2],
        paddingHorizontal: space[3],
        borderRadius: 14,
        borderWidth: 1,
        borderColor: mine ? color.chrome : color.line,
        backgroundColor: pressed ? color.groundDeep : color.surface,
      })}
    >
      <Icon name={attachment.kind === "IMAGE" ? "image" : "document"} size={20} color={url ? "accentText" : "ink3"} />
      <Text variant="small" weight="semibold" color={url ? "ink" : "ink3"} numberOfLines={1} style={{ flexShrink: 1 }}>
        {url ? label : "Attachment unavailable"}
      </Text>
    </Pressable>
  );
}
