import { type ManagedWithdrawal, PAYMENT_METHODS, type PaymentMethod, type WithdrawalAction } from "@bookmops/api/v1";
import { Button, Card, ChoiceChips, Pill, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { useDecideWithdrawal, useManagedWithdrawal, useMe } from "@/data/queries";
import { ALREADY_HANDLED, handledElsewhere, PAYMENT_METHOD_LABEL, paymentMethodLabel, withdrawalStatus } from "@/features/manage/words";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle } from "@/features/record/ui";
import { formatMoney, shortDate } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";

const METHODS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }));

/**
 * One withdrawal request, decided as on the web's payouts page: approve it,
 * mark it paid (which emails the cleaner), or reject it (which returns the
 * amount to their balance). The office picks how it's paid; the cleaner
 * only ever asked for an amount.
 */
export default function WithdrawalScreen() {
  return (
    <Guarded need="WITHDRAWALS">
      <WithdrawalView />
    </Guarded>
  );
}

function WithdrawalView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const w = useManagedWithdrawal(id);
  const tz = me.data?.company.timezone;
  const header = <BackHeader title="Withdrawal" subtitle={w.data?.employee.name} fallback="/manage/approvals" backLabel="Back to approvals" />;
  if (w.isPending || !tz) {
    return (
      <Page header={header}>
        <Loading label="Loading withdrawal" />
      </Page>
    );
  }
  if (w.isError) {
    return (
      <Page header={header}>
        <LoadError error={w.error} onRetry={() => w.refetch()} />
      </Page>
    );
  }
  return <Decide header={header} w={w.data} timeZone={tz} currency={me.data?.company.currency ?? "CAD"} />;
}

function Decide({ header, w, timeZone, currency }: { header: ReactNode; w: ManagedWithdrawal; timeZone: string; currency: string }) {
  const decide = useDecideWithdrawal(w.id);
  const key = useEventKey();
  const [method, setMethod] = useState<PaymentMethod>((w.paymentMethod as PaymentMethod | null) ?? "E_TRANSFER");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<WithdrawalAction | null>(null);
  const [handled, setHandled] = useState(false);
  const status = withdrawalStatus(w.status);
  const amount = formatMoney(w.amountCents, currency);
  const open = w.status === "PENDING" || w.status === "APPROVED";

  async function run(action: WithdrawalAction) {
    if (decide.isPending) return;
    setError(null);
    setHandled(false);
    const how = PAYMENT_METHOD_LABEL[method];
    const ok = await confirm(
      action === "APPROVE"
        ? { title: `Approve ${amount}?`, message: `To be paid by ${how}. Mark it paid once the money is sent.`, confirmLabel: "Approve" }
        : action === "COMPLETE"
          ? { title: `Mark ${amount} paid?`, message: `Sent by ${how}. ${w.employee.name} gets an email saying it's on its way.`, confirmLabel: "Mark paid" }
          : { title: `Reject ${amount}?`, message: `It goes back to ${w.employee.name}'s balance to withdraw again.`, confirmLabel: "Reject", destructive: true },
    );
    if (!ok) return;
    const body = { action, paymentMethod: action === "REJECT" ? null : method };
    setRunning(action);
    decide.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
        onError: (e) => {
          key.failed(e);
          if (handledElsewhere(e)) {
            setHandled(true);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          } else {
            setError(errorText(e));
          }
        },
        onSettled: () => setRunning(null),
      },
    );
  }

  return (
    <Page
      header={header}
      footer={
        open ? (
          <>
            <FormError message={error} />
            <Button label="Mark paid" loading={running === "COMPLETE"} disabled={decide.isPending} onPress={() => void run("COMPLETE")} />
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <Button label="Reject" variant="danger" size="md" style={{ flex: 1 }} loading={running === "REJECT"} disabled={decide.isPending} onPress={() => void run("REJECT")} />
              {w.status === "PENDING" ? (
                <Button label="Approve" variant="secondary" size="md" style={{ flex: 1 }} loading={running === "APPROVE"} disabled={decide.isPending} onPress={() => void run("APPROVE")} />
              ) : null}
            </View>
          </>
        ) : undefined
      }
    >
      {handled ? (
        <Notice tone="neutral" icon="info">
          {ALREADY_HANDLED}
        </Notice>
      ) : null}
      <Card padding={5}>
        <View style={{ gap: space[2] }} accessible accessibilityLabel={`${w.employee.name} asked for ${amount}. ${status.label}.`}>
          <Pill label={status.label} tone={status.tone} />
          <Text variant="display" color="chrome" numeral>
            {amount}
          </Text>
          <Text variant="body" color="ink2" numeral>
            {w.employee.name} · requested {shortDate(w.requestedAt, timeZone)}
          </Text>
        </View>
      </Card>
      <Notice tone="neutral" icon="info">
        This is what they receive. The instant-payout fee came off when they asked, so send exactly this amount.
      </Notice>
      {w.note ? (
        <Notice tone="neutral" icon="chat" title="Their note">
          {w.note}
        </Notice>
      ) : null}
      {open ? (
        <>
          <SectionTitle>How it's being paid</SectionTitle>
          <ChoiceChips label="How it's being paid" options={METHODS} value={method} onChange={setMethod} />
        </>
      ) : (
        <Notice tone={w.status === "REJECTED" ? "critical" : "ok"} icon={w.status === "REJECTED" ? "close" : "check"} title={status.label}>
          {[w.processedAt ? `Handled ${shortDate(w.processedAt, timeZone)}` : null, paymentMethodLabel(w.paymentMethod)].filter(Boolean).join(" · ") || " "}
        </Notice>
      )}
    </Page>
  );
}
