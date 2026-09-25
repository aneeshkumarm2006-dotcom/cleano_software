import type { ChecklistItem } from "@bookmops/api/v1";
import { color, Icon, minTouch, radius, space, Text } from "@bookmops/ui-native";
import { useLocalSearchParams } from "expo-router";
import { Fragment } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useClockActions } from "@/data/outbox/actions";
import { useChecklist } from "@/data/queries";
import { BackHeader } from "@/features/record/ui";

/** The job's checklist, by room. Each tick is saved on the phone and sent. */
export default function Checklist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const checklist = useChecklist(id);
  const { setChecklistItem } = useClockActions(id);
  const items = checklist.data?.items ?? [];
  const done = items.filter((i) => i.done).length;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <BackHeader
        safeTop
        title="Checklist"
        fallback={{ pathname: "/jobs/[id]", params: { id } }}
        right={
          items.length ? (
            <Text variant="heading" numeral color="chrome" accessibilityLabel={`${done} of ${items.length} done`}>
              {done}
              <Text variant="heading" color="ink3">
                /{items.length}
              </Text>
            </Text>
          ) : null
        }
      />

      <ScrollView contentContainerStyle={{ padding: space[4], paddingTop: space[1], gap: space[5], paddingBottom: insets.bottom + space[8] }}>
        {checklist.isPending ? (
          <Loading label="Loading the checklist" />
        ) : checklist.isError ? (
          <LoadError error={checklist.error} onRetry={() => checklist.refetch()} />
        ) : items.length === 0 ? (
          <Empty icon="check" title="No checklist for this job" />
        ) : (
          bySection(items).map(([section, rows]) => (
            <View key={section} style={{ gap: space[2] }}>
              <Text variant="eyebrow" color="ink3" accessibilityRole="header" style={{ paddingLeft: space[1] }}>
                {section}
              </Text>
              <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
                {rows.map((item, i) => (
                  <Fragment key={item.id}>
                    {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 56 }} /> : null}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.done }}
                      accessibilityLabel={item.label}
                      onPress={() => setChecklistItem(item.id, !item.done)}
                      style={({ pressed }) => ({
                        minHeight: minTouch + 12,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space[3],
                        paddingHorizontal: space[4],
                        backgroundColor: pressed ? color.groundDeep : color.surface,
                      })}
                    >
                      <View
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: item.done ? color.success : color.surface,
                          borderWidth: item.done ? 0 : 2,
                          borderColor: color.lineStrong,
                        }}
                      >
                        {item.done ? <Icon name="check" size={20} color="onChrome" /> : null}
                      </View>
                      <Text
                        variant="bodyStrong"
                        color={item.done ? "ink3" : "ink"}
                        style={{ flex: 1, textDecorationLine: item.done ? "line-through" : "none" }}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function bySection(items: readonly ChecklistItem[]): [string, ChecklistItem[]][] {
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const key = item.section ?? "General";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups];
}
