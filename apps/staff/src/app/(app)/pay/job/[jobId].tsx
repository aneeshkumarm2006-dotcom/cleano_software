import type { JobPayResponse } from "@bookmops/api/v1";
import { Card, color, Icon, IconButton, space, Text } from "@bookmops/ui-native";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadError, Loading } from "@/components/QueryState";
import { useJobPay, useMe } from "@/data/queries";
import { MoneyLine } from "@/features/pay/PayParts";
import { formatMoney, shortDate } from "@/lib/format";

/**
 * What one job paid, and why: the web's pay breakdown as a cleaner sees it.
 * Only this cleaner's own money: never the client's price, the tier, or
 * anyone else's share.
 */
export default function JobPayScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const pay = useJobPay(jobId);
  const tz = me.data?.company.timezone;

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/pay"))} />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
          Job pay
        </Text>
      </View>
      {pay.isPending || me.isPending ? (
        <Loading label="Loading job pay" />
      ) : pay.isError || me.isError || !tz ? (
        <View style={{ padding: space[4] }}>
          <LoadError
            error={pay.error ?? me.error}
            onRetry={() => {
              void me.refetch();
              void pay.refetch();
            }}
          />
        </View>
      ) : (
        <Body data={pay.data} currency={me.data?.company.currency ?? "CAD"} timeZone={tz} bottom={insets.bottom} />
      )}
    </View>
  );
}

function Body({ data, currency, timeZone, bottom }: { data: JobPayResponse; currency: string; timeZone: string; bottom: number }) {
  const money = (c: number) => formatMoney(c, currency);
  const boost = boostText(data.ratingBoost);

  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: bottom + space[6] }} showsVerticalScrollIndicator={false}>
      <View style={{ gap: space[1] }}>
        <Text variant="title" accessibilityRole="header">
          {data.service}
        </Text>
        <Text variant="body" color="ink2">
          {[shortDate(data.date, timeZone), data.area].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <View accessible accessibilityLabel={`You were paid ${money(data.totalCents)} for this job`}>
        <Text variant="eyebrow" color="ink3">
          Your pay
        </Text>
        <Text variant="display" color="success" numeral style={{ marginTop: space[1] }}>
          {money(data.totalCents)}
        </Text>
      </View>

      <Card padding={4}>
        <View style={{ gap: space[3] }}>
          <MoneyLine
            label={data.hourlyRateCents != null ? `Work (${money(data.hourlyRateCents)}/h)` : "Work"}
            value={money(data.workCents)}
          />
          {data.tipCents > 0 ? <MoneyLine label="Your share of tips" value={`+${money(data.tipCents)}`} tone="success" /> : null}
          {data.parkingCents > 0 ? <MoneyLine label="Your share of parking" value={`+${money(data.parkingCents)}`} tone="success" /> : null}
          <View style={{ height: 1, backgroundColor: color.line }} />
          <MoneyLine label="Total" value={money(data.totalCents)} strong />
        </View>
      </Card>

      <Card padding={4}>
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <Icon name="info" size={20} color="accentText" />
          <View style={{ flex: 1, gap: space[1] }}>
            <Text variant="eyebrow" color="ink3" accessibilityRole="header">
              How it's worked out
            </Text>
            <Text variant="body">{data.basisLabel}</Text>
            {data.tipCents > 0 || data.parkingCents > 0 ? (
              <Text variant="small" color="ink2">
                Tips and parking are shared equally by everyone on the job.
              </Text>
            ) : null}
          </View>
        </View>
      </Card>

      {boost ? (
        <Card padding={4}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <Icon name="star" size={20} color="warning" />
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="eyebrow" color="ink3" accessibilityRole="header">
                Rating boost
              </Text>
              <Text variant="body">{boost}</Text>
            </View>
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

function boostText(b: JobPayResponse["ratingBoost"]): string | null {
  switch (b.state) {
    case "APPLIED":
      return b.multiplier && b.multiplier > 1
        ? `Your rating raised your rate by ${Math.round((b.multiplier - 1) * 100)}% on this job.`
        : "Your rating is counted in your rate on this job.";
    case "LOCKED":
      return b.ratingsRequired != null
        ? `Your rating starts lifting your pay after ${b.ratingsRequired} ratings. You have ${b.ratingsSoFar ?? 0} so far.`
        : "Your rating will start lifting your pay once you have enough ratings.";
    case "NOT_APPLICABLE":
      return b.reason === "HOURLY"
        ? "Hourly jobs pay by the hour, so your rating doesn't change them."
        : "This job pays a set amount, so your rating doesn't change it.";
    default:
      return null;
  }
}
