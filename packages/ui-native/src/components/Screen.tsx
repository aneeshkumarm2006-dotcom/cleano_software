import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, space } from "../tokens";

export interface ScreenProps {
  children: ReactNode;
  /** Pinned above the scrolling content. */
  header?: ReactNode;
  /** Scrolls by default; `false` for screens that manage their own lists. */
  scroll?: boolean;
  /** Pull to refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * Room kept clear at the bottom for the floating tab bar, so the last item
   * can scroll out from under it.
   */
  bottomInset?: number;
}

/** The frame of every screen: the ground colour, safe areas, and scrolling. */
export function Screen({ children, header, scroll = true, refreshing, onRefresh, bottomInset = 0 }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const body = (
    <View style={{ paddingHorizontal: space[4], gap: space[4], paddingBottom: insets.bottom + bottomInset + space[4] }}>
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[3] }}>{header}</View>
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} />
            ) : undefined
          }
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
    </View>
  );
}
