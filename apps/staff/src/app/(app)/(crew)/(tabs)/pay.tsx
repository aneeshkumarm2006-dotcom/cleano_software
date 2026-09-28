import { Button, Screen, space, TAB_BAR_HEIGHT, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useMe, usePay, usePayouts, useWithdrawals } from "@/data/queries";
import { BalanceCard, PeriodRow, RowGroup, SectionTitle, WithdrawalRow, YearCard } from "@/features/pay/PayParts";

/**
 * My pay: what can be withdrawn now, what's on its way, the year so far, and
 * every pay period and withdrawal. Everything is the cleaner's own and comes
 * from the same earnings computation the web's My pay uses.
 */
export default function PayTab() {
  const me = useMe();
  const pay = usePay();
  const payouts = usePayouts();
  const withdrawals = useWithdrawals();
  const tz = me.data?.company.timezone;
  const currency = me.data?.company.currency ?? "CAD";

  const refresh = () => {
    void pay.refetch();
    void payouts.refetch();
    void withdrawals.refetch();
  };

  const periods = payouts.data?.pages.flatMap((p) => p.items) ?? [];
  const requests = withdrawals.data?.pages.flatMap((p) => p.items) ?? [];
  const openPeriod = (id: string) => router.push({ pathname: "/pay/period/[id]", params: { id } });

  return (
    <Screen header={<ScreenHeader title="My pay" />} bottomInset={TAB_BAR_HEIGHT} refreshing={pay.isRefetching} onRefresh={refresh}>
      {pay.isPending || me.isPending ? (
        <Loading label="Loading your pay" />
      ) : pay.isError || me.isError || !tz ? (
        <LoadError
          error={pay.error ?? me.error}
          onRetry={() => {
            void me.refetch();
            void pay.refetch();
          }}
        />
      ) : (
        <>
          <BalanceCard pay={pay.data} currency={currency} onWithdraw={() => router.push("/pay/withdraw")} />
          <YearCard pay={pay.data} currency={currency} />

          <View style={{ gap: space[3] }}>
            <SectionTitle title="Pay periods" />
            {payouts.isPending ? (
              <Loading label="Loading pay periods" />
            ) : payouts.isError ? (
              <LoadError error={payouts.error} onRetry={() => payouts.refetch()} />
            ) : !pay.data.currentPeriod && periods.length === 0 ? (
              <Empty icon="pay" title="No pay periods yet" detail="Once you finish a job, its pay shows up here." />
            ) : (
              <RowGroup>
                {[
                  ...(pay.data.currentPeriod
                    ? [<PeriodRow key="current" period={pay.data.currentPeriod} currency={currency} onPress={() => openPeriod(pay.data.currentPeriod!.id)} />]
                    : []),
                  ...periods.map((p) => <PeriodRow key={p.id} period={p} currency={currency} onPress={() => openPeriod(p.id)} />),
                ]}
              </RowGroup>
            )}
            {payouts.hasNextPage ? (
              <Button
                label="Show older periods"
                variant="secondary"
                size="md"
                loading={payouts.isFetchingNextPage}
                onPress={() => payouts.fetchNextPage()}
              />
            ) : null}
            {pay.data.currentPeriod?.isLive ? (
              <Text variant="small" color="ink3">
                This week is an estimate until payroll closes it.
              </Text>
            ) : null}
          </View>

          <View style={{ gap: space[3] }}>
            <SectionTitle title="Withdrawals" />
            {withdrawals.isPending ? (
              <Loading label="Loading withdrawals" />
            ) : withdrawals.isError ? (
              <LoadError error={withdrawals.error} onRetry={() => withdrawals.refetch()} />
            ) : requests.length === 0 ? (
              <Text variant="body" color="ink2">
                You haven't asked for a withdrawal yet.
              </Text>
            ) : (
              <RowGroup>{requests.map((w) => <WithdrawalRow key={w.id} w={w} currency={currency} timeZone={tz} />)}</RowGroup>
            )}
            {withdrawals.hasNextPage ? (
              <Button
                label="Show older withdrawals"
                variant="secondary"
                size="md"
                loading={withdrawals.isFetchingNextPage}
                onPress={() => withdrawals.fetchNextPage()}
              />
            ) : null}
          </View>
        </>
      )}
    </Screen>
  );
}
