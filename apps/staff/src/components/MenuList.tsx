import { color, CountBadge, Icon, minTouch, radius, space, Text, type IconName } from "@bookmops/ui-native";
import { Fragment } from "react";
import { Pressable, View } from "react-native";

export interface MenuItem {
  key: string;
  label: string;
  icon: IconName;
  onPress?: () => void;
  count?: number;
  /** A short status on the right: "2 LOW", "6/7". */
  status?: string;
  /** How the status reads: a warning ("2 LOW", the default) or progress ("6/7"). */
  statusTone?: "warning" | "success";
  /** Not built yet: shown, marked, and not tappable — never a dead end. */
  soon?: boolean;
}

/** A titled group of rows, as on the More screen. */
export function MenuGroup({ title, items }: { title: string; items: readonly MenuItem[] }) {
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ paddingLeft: space[1] }}>
        {title}
      </Text>
      <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 56 }} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.soon ? `${item.label}, coming soon` : item.status ? `${item.label}, ${item.status}` : item.label}
              accessibilityState={{ disabled: item.soon || !item.onPress }}
              disabled={item.soon || !item.onPress}
              onPress={item.onPress}
              style={({ pressed }) => ({
                minHeight: minTouch + 8,
                flexDirection: "row",
                alignItems: "center",
                gap: space[3],
                paddingHorizontal: space[4],
                backgroundColor: pressed ? color.groundDeep : color.surface,
              })}
            >
              <View style={{ width: 28, alignItems: "center" }}>
                <Icon name={item.icon} size={22} color={item.soon ? "ink3" : "accentText"} />
              </View>
              <Text variant="bodyStrong" color={item.soon ? "ink3" : "ink"} style={{ flex: 1 }}>
                {item.label}
              </Text>
              {item.soon ? (
                <Text variant="eyebrow" color="ink3">
                  Soon
                </Text>
              ) : (
                <>
                  {item.status ? (
                    <Text variant="eyebrow" color={item.statusTone ?? "warning"} numeral>
                      {item.status}
                    </Text>
                  ) : null}
                  {item.count ? <CountBadge count={item.count} ring={color.surface} /> : null}
                  <Icon name="forward" size={18} color="ink3" />
                </>
              )}
            </Pressable>
          </Fragment>
        ))}
      </View>
    </View>
  );
}
