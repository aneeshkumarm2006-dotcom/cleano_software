import type { PayPeriodSummary, PayResponse, Withdrawal } from "@bookmops/api/v1";
import { Button, Card, color, Icon, minTouch, Pill, radius, space, Text } from "@bookmops/ui-native";
import { Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { formatMoney, formatMoneyWhole, shortDate } from "@/lib/format";

import { hoursText, periodLine, periodRange, periodStatus, withdrawalStatus } from "./words";

/**
 * The one thing on this screen that matters most, as the solid block: what
 * can be withdrawn now, and the button to do it.
 */
export function BalanceCard({ pay, currency, onWithdraw }: { pay: PayResponse; currency: string; onWithdraw: () => void }) {
  const available = pay.balance.availableCents;
  const canWithdraw = available >= pay.withdrawal.minimumCents;
  return (
    <Card tone="active" padding={5}>
      <View accessible accessibilityLabel={`Available to withdraw: ${formatMoney(available, currency)}`}>
        <Text variant="eyebrow" color="onChrome3">
          Available to withdraw
        </Text>
        <Text variant="display" color="onChrome" numeral style={{ fontSize: 40, lineHeight: 46, marginTop: space[1] }}>
          {formatMoney(available, currency)}
        </Text>
      </View>
      <Button
        label="Withdraw"
        variant="onChrome"
        disabled={!canWithdraw}
        onPress={onWithdraw}
        style={{ marginTop: space[4] }}
        accessibilityHint={canWithdraw ? "Choose an amount, then confirm" : undefined}
      />
      {!canWithdraw ? (
        <Text variant="small" color="onChrome2" style={{ marginTop: space[2] }}>
          {available > 0
            ? `You can withdraw once you have ${formatMoney(pay.withdrawal.minimumCents, currency)}.`
            : "Money from paid pay periods shows up here."}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", marginTop: space[4], paddingTop: space[4], borderTopWidth: 1, borderTopColor: color.lineOnChrome }}>
        <ChromeStat label="Pending" value={formatMoney(pay.balance.pendingCents, currency)} />
        <View style={{ width: 1, backgroundColor: color.lineOnChrome }} />
        <ChromeStat
          label={pay.currentPeriod?.isLive ? "This week so far" : "This period"}
          value={pay.currentPeriod ? formatMoney(pay.currentPeriod.finalCents, currency) : "—"}
          inset
        />
      </View>
    </Card>
  );
}

function ChromeStat({ label, value, inset }: { label: string; value: string; inset?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flex: 1, gap: 2, paddingLeft: inset ? space[4] : 0 }}>
      <Text variant="eyebrow" color="onChrome3" style={{ fontSize: 10 }}>
        {label}
      </Text>
      <Text variant="subheading" color="onChrome" numeral>
        {value}
      </Text>
    </View>
  );
}

/** The year so far: four figures, money first. */
export function YearCard({ pay, currency }: { pay: PayResponse; currency: string }) {
  const y = pay.yearToDate;
  const r = pay.rating;
  return (
    <Card padding={4}>
      <SectionTitle title={`${y.year} so far`} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space[4], marginTop: space[3] }}>
        <Figure value={formatMoneyWhole(y.earnedCents, currency)} label="Earned" tone="success" />
        <Figure value={hoursText(y.hours).replace(" h", "")} label="Hours" />
        <Figure value={String(y.jobsCompleted)} label="Jobs done" />
        <Figure
          value={r.average != null ? r.average.toFixed(1) : "—"}
          label={r.average != null ? `Rating · ${r.count} rated` : "No reviews yet"}
          icon={r.average != null ? <Icon name="star" size={18} color="warning" /> : null}
        />
      </View>
    </Card>
  );
}

function Figure({ value, label, tone, icon }: { value: string; label: string; tone?: "success"; icon?: ReactNode }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ width: "50%", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <Text variant="heading" color={tone ?? "chrome"} numeral style={{ fontSize: 22, lineHeight: 26 }}>
          {value}
        </Text>
        {icon}
      </View>
      <Text variant="small" color="ink2">
        {label}
      </Text>
    </View>
  );
}

/** An uppercase section label with a hairline running off it, as in the design. */
export function SectionTitle({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <Text variant="eyebrow" color="accentText" accessibilityRole="header">
        {title}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: color.line }} />
      {trailing}
    </View>
  );
}

/** Rows in one white block, separated by hairlines. */
export function RowGroup({ children }: { children: ReactNode[] }) {
  return (
    <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
      {children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: space[4] }} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

/** One pay period: dates, jobs and hours, where it stands, and what it pays. */
export function PeriodRow({ period, currency, onPress }: { period: PayPeriodSummary; currency: string; onPress: () => void }) {
  const status = periodStatus(period.status);
  const range = periodRange(period.startDate, period.endDate);
  const amount = formatMoney(period.finalCents, currency);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${range}, ${periodLine(period)}, ${status.label}, ${period.isLive ? "estimate " : ""}${amount}`}
      accessibilityHint="Shows the jobs in this period"
      onPress={onPress}
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
        <Text variant="bodyStrong" numeral>
          {range}
        </Text>
        <Text variant="small" color="ink2" numeral>
          {periodLine(period)}
        </Text>
      </View>
      <Pill label={status.label} tone={status.tone} />
      <Text variant="bodyStrong" numeral style={{ minWidth: 76, textAlign: "right" }}>
        {amount}
      </Text>
      <Icon name="forward" size={16} color="ink3" />
    </Pressable>
  );
}

/** One withdrawal request: when, where it stands, the amount and what reaches the cleaner. */
export function WithdrawalRow({ w, currency, timeZone }: { w: Withdrawal; currency: string; timeZone: string }) {
  const status = withdrawalStatus(w.status);
  const amount = formatMoney(w.amountCents, currency);
  const net = w.netCents != null && w.netCents !== w.amountCents ? formatMoney(w.netCents, currency) : null;
  const date = shortDate(w.requestedAt, timeZone);
  return (
    <View
      accessible
      accessibilityLabel={[`Withdrawal ${date}`, status.label, amount, net ? `you get ${net}` : null, w.note].filter(Boolean).join(", ")}
      style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: minTouch + 16 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{date}</Text>
        {w.note ? (
          <Text variant="small" color="ink2" numberOfLines={1}>
            {w.note}
          </Text>
        ) : null}
      </View>
      <Pill label={status.label} tone={status.tone} />
      <View style={{ alignItems: "flex-end", minWidth: 76 }}>
        <Text variant="bodyStrong" numeral>
          {amount}
        </Text>
        {net ? (
          <Text variant="small" color="ink3" numeral>
            you get {net}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A label and an amount on one line, for a breakdown. `strong` is the bottom line. */
export function MoneyLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" | "success" }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: "row", alignItems: "baseline", gap: space[3] }}>
      <Text variant={strong ? "bodyStrong" : "body"} color={strong ? "ink" : "ink2"} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? "subheading" : "bodyStrong"} color={tone ?? (strong ? "chrome" : "ink")} numeral>
        {value}
      </Text>
    </View>
  );
}
