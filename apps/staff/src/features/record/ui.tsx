// The frame the "my work" and "my record" screens share: a back header, a
// scrolling body that makes room for the keyboard, and an optional footer
// pinned under it for the screen's one action. Plus the small pieces those
// screens all use — a status's pill tone, a notice, a section title — so the six
// areas read as one family.
import { ApiError } from "@bookmops/api/client";
import { color, Icon, radius, space, Text, type IconName, type PillTone } from "@bookmops/ui-native";
import type { Href } from "expo-router";
import type { ReactNode, RefObject } from "react";
import { Alert, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton, goBackOr } from "@/components/BackButton";

/** Back to where the person came from, or to More when opened by a link. */
export function goBack() {
  goBackOr("/more");
}

export interface BackHeaderProps {
  title: string;
  subtitle?: string;
  /** An action or a figure at the right: a compose button, "3/12". */
  right?: ReactNode;
  /** Where the back arrow goes when there's nothing to go back to. Defaults to More. */
  fallback?: Href;
  /** What the back arrow says to a screen reader: "Back to my pay". */
  backLabel?: string;
  /**
   * True on a screen that doesn't use Page, so the header keeps clear of the
   * status bar itself, at the same height a tab screen's title sits.
   */
  safeTop?: boolean;
}

/** The top of every screen that isn't a tab: the back arrow and the title. */
export function BackHeader({ title, subtitle, right, fallback = "/more", backLabel, safeTop }: BackHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingTop: safeTop ? insets.top + space[3] : 0,
        paddingBottom: space[3],
      }}
    >
      <BackButton fallback={fallback} label={backLabel} />
      <View style={{ flex: 1 }}>
        <Text variant={subtitle ? "subheading" : "heading"} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color="ink2" numeral numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export interface PageProps {
  header: ReactNode;
  children: ReactNode;
  /** Pinned under the scrolling body; moves up with the keyboard. */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** False while a finger is signing, so the page doesn't scroll under it. */
  scrollEnabled?: boolean;
  scrollRef?: RefObject<ScrollView | null>;
}

export function Page({ header, children, footer, refreshing, onRefresh, scrollEnabled = true, scrollRef }: PageProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.ground, paddingTop: insets.top + space[3] }}>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={scrollEnabled}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: space[4], paddingTop: space[1], gap: space[4], paddingBottom: (footer ? space[6] : insets.bottom + space[8]) }}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              paddingHorizontal: space[4],
              paddingTop: space[3],
              paddingBottom: insets.bottom + space[3],
              backgroundColor: color.surface,
              borderTopWidth: 1,
              borderTopColor: color.line,
              gap: space[2],
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export type Tone = "ok" | "warn" | "critical" | "neutral" | "accent";

const TONE: Record<Tone, { bg: string; fg: "success" | "warning" | "danger" | "ink2" | "accentText" }> = {
  ok: { bg: color.successSoft, fg: "success" },
  warn: { bg: color.warningSoft, fg: "warning" },
  critical: { bg: color.dangerSoft, fg: "danger" },
  neutral: { bg: color.groundDeep, fg: "ink2" },
  accent: { bg: color.accentSoft, fg: "accentText" },
};

/**
 * The Pill tone for a Tone, so a status reads the same in a pill as in a
 * notice: `<Pill label="Signed" tone={pillTone("ok")} />`.
 */
export function pillTone(tone: Tone): PillTone {
  return PILL_TONE[tone];
}

const PILL_TONE: Record<Tone, PillTone> = {
  ok: "success",
  warn: "warning",
  critical: "danger",
  neutral: "neutral",
  accent: "accent",
};

/** A filled message block. Importance is the fill, never a stripe. */
export function Notice({ tone, icon, children, title }: { tone: Tone; icon: IconName; title?: string; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start", padding: space[4], borderRadius: radius.lg, backgroundColor: t.bg }}
    >
      <Icon name={icon} size={20} color={t.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="bodyStrong" color={t.fg === "ink2" ? "ink" : t.fg}>
            {title}
          </Text>
        ) : null}
        {typeof children === "string" ? (
          <Text variant="small" color="ink" style={{ lineHeight: 19 }}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** "TO DO", "COMPLETED": the eyebrow above a group. */
export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: space[1], marginBottom: -space[2] }}>
      <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ flex: 1 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A mutation's failure, in the server's words when it sent some. */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "That didn't go through. Check your connection and try again.";
}

/** An inline error under a form, read out when it appears. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="assertive" style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
      <Icon name="warning" size={18} color="danger" />
      <Text variant="small" color="danger" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}

/** Ask before doing something that is recorded. Resolves true on the confirm button. */
export function confirm({
  title,
  message,
  confirmLabel,
  destructive,
}: {
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** 12, or 0.5 for the odd fractional row: never "12.000000001". */
export function quantityText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
