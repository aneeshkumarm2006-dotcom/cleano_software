import type { PayPeriodDetailResponse } from "@bookmops/api/v1";
import { Card, color, Icon, minTouch, Pill, space, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useMe, usePayPeriod } from "@/data/queries";
import { MoneyLine, RowGroup, SectionTitle } from "@/features/pay/PayParts";
import { hoursText, periodLine, periodRange, periodStatus } from "@/features/pay/words";
import { formatMoney, shortDate } from "@/lib/format";

/** One pay period: how its total is made up, and the jobs in it. */
export default function PayPeriodScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const period = usePayPeriod(id);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <BackButton fallback="/pay" label="Back to my pay" />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
          Pay period
        </Text>
      </View>
      {period.isPending || me.isPending ? (
        <Loading label="Loading pay period" />
      ) : period.isError || me.isError || !tz ? (
        <View style={{ padding: space[4] }}>
          <LoadError
            error={period.error ?? me.error}
            onRetry={() => {
              void me.refetch();
              void period.refetch();
            }}
          />
        </View>
      ) : (
        <Body data={period.data} currency={me.data?.company.currency ?? "CAD"} timeZone={tz} bottom={insets.bottom} />
      )}
    </View>
  );
}

function Body({ data, currency, timeZone, bottom }: { data: PayPeriodDetailResponse; currency: string; timeZone: string; bottom: number }) {
  const p = data.period;
  const status = periodStatus(p.status);
  const money = (c: number) => formatMoney(c, currency);

  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: bottom + space[6] }} showsVerticalScrollIndicator={false}>
      <View style={{ gap: space[2] }}>
        <Pill label={status.label} tone={status.tone} />
        <Text variant="title" accessibilityRole="header" numeral>
          {periodRange(p.startDate, p.endDate)}
        </Text>
        <Text variant="body" color="ink2" numeral>
          {periodLine(p)}
        </Text>
      </View>

      <Card padding={4}>
        <View style={{ gap: space[3] }}>
          <MoneyLine label={p.isLive ? "Earned so far" : "Earned"} value={money(p.baseCents)} />
          {p.adjustmentsCents !== 0 ? <MoneyLine label="Adjustments" value={`${p.adjustmentsCents > 0 ? "+" : "−"}${money(Math.abs(p.adjustmentsCents))}`} /> : null}
          {p.deductionsCents !== 0 ? <MoneyLine label="Deductions" value={`−${money(p.deductionsCents)}`} tone="danger" /> : null}
          {p.reimbursementsCents !== 0 ? <MoneyLine label="Reimbursements" value={`+${money(p.reimbursementsCents)}`} /> : null}
          <View style={{ height: 1, backgroundColor: color.line }} />
          <MoneyLine label={p.isLive ? "Estimated total" : "Total"} value={money(p.finalCents)} strong />
        </View>
      </Card>
      {p.isLive ? (
        <Text variant="small" color="ink3">
          An estimate: it's final once payroll closes this period.
        </Text>
      ) : p.paidAt ? (
        <Text variant="small" color="ink3">
          Paid {shortDate(p.paidAt, timeZone)}.
        </Text>
      ) : null}

      <View style={{ gap: space[3] }}>
        <SectionTitle title="Jobs" />
        {data.jobs.length === 0 ? (
          <Empty icon="jobs" title="No jobs in this period" />
        ) : (
          <RowGroup>
            {data.jobs.map((j) => (
              <Pressable
                key={j.jobId}
                accessibilityRole="button"
                accessibilityLabel={`${shortDate(j.date, timeZone)}, ${[j.area, j.service].filter(Boolean).join(", ")}, ${hoursText(j.hours)}, ${money(j.totalCents)}`}
                accessibilityHint="Shows how this job's pay was worked out"
                onPress={() => router.push({ pathname: "/pay/job/[jobId]", params: { jobId: j.jobId } })}
                style={({ pressed }) => ({
                  minHeight: minTouch + 16,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space[3],
                  paddingHorizontal: space[4],
                  paddingVertical: space[3],
                  backgroundColor: pressed ? color.groundDeep : color.surface,
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {shortDate(j.date, timeZone)}
                    {j.area ? ` · ${j.area}` : ""}
                  </Text>
                  <Text variant="small" color="ink2" numeral numberOfLines={1}>
                    {j.service} · {hoursText(j.hours)}
                  </Text>
                </View>
                <Text variant="bodyStrong" color="success" numeral>
                  {money(j.totalCents)}
                </Text>
                <Icon name="forward" size={16} color="ink3" />
              </Pressable>
            ))}
          </RowGroup>
        )}
      </View>
    </ScrollView>
  );
}

