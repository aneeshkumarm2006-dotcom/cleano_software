import { ApiError } from "@bookmops/api/client";
import type { PayResponse, WithdrawalResponse } from "@bookmops/api/v1";
import { Button, Card, color, Icon, IconButton, radius, space, Text, TextField } from "@bookmops/ui-native";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadError, Loading } from "@/components/QueryState";
import { useMe, usePay, useRequestWithdrawal } from "@/data/queries";
import { MoneyLine } from "@/features/pay/PayParts";
import { feeCents, parseAmount, percentText } from "@/features/pay/words";
import { formatMoney } from "@/lib/format";

/**
 * Asking for money: an amount, a check against the balance, a confirmation
 * that says exactly what will happen, then the answer. The app's check is for
 * the person; the server checks the balance again, in a transaction, and its
 * answer is the one that counts.
 */
export default function Withdraw() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const pay = usePay();
  const currency = me.data?.company.currency ?? "CAD";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <IconButton icon="back" label="Back to my pay" onPress={() => router.back()} />
      </View>
      {pay.isPending || me.isPending ? (
        <Loading label="Loading your balance" />
      ) : pay.isError || me.isError ? (
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
        <Flow pay={pay.data} currency={currency} bottom={insets.bottom} />
      )}
    </KeyboardAvoidingView>
  );
}

type Step = { kind: "form" } | { kind: "confirm"; amountCents: number; note: string } | { kind: "done"; result: WithdrawalResponse };

function Flow({ pay, currency, bottom }: { pay: PayResponse; currency: string; bottom: number }) {
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const withdraw = useRequestWithdrawal();
  /**
   * The idempotency key, tied to the request it was made for. Kept until the
   * server gives a definite answer, even if the person goes back and comes
   * again with the same amount and note: when the outcome of the last send is
   * unknown, sending the same request again must reuse its key, or a request
   * that did land would be made a second time. A different request gets a
   * new key.
   */
  const key = useRef<{ id: string; fingerprint: string } | null>(null);

  const available = pay.balance.availableCents;
  const { minimumCents, feeBasisPoints } = pay.withdrawal;
  const money = (c: number) => formatMoney(c, currency);

  const cents = parseAmount(amount);
  const problem =
    amount.trim() === ""
      ? "Enter an amount."
      : cents == null
        ? "Enter an amount like 120 or 120.50."
        : cents < minimumCents
          ? `The smallest withdrawal is ${money(minimumCents)}.`
          : cents > available
            ? `That's more than you have available (${money(available)}).`
            : null;

  function review() {
    setTouched(true);
    setServerError(null);
    if (problem || cents == null) return;
    setStep({ kind: "confirm", amountCents: cents, note: note.trim() });
  }

  function send(amountCents: number, sentNote: string) {
    setServerError(null);
    const fingerprint = `${amountCents}|${feeBasisPoints}|${sentNote}`;
    if (key.current?.fingerprint !== fingerprint) key.current = { id: randomUUID(), fingerprint };
    const clientEventId = key.current.id;
    withdraw.mutate(
      { amountCents, expectedFeeBasisPoints: feeBasisPoints, clientEventId, ...(sentNote ? { note: sentNote } : {}) },
      {
        onSuccess: (result) => {
          key.current = null;
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setStep({ kind: "done", result });
        },
        onError: (error) => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          const retryable = error instanceof ApiError && error.retryable;
          if (!retryable) key.current = null;
          if (error instanceof ApiError && (error.code === "INSUFFICIENT_BALANCE" || error.code === "AMOUNT_TOO_SMALL" || error.code === "FEE_CHANGED")) {
            // The balance or the fee moved under us: back to the amount, with
            // the server's reason. The pay summary refetches, so the form
            // shows the new figures before they confirm again.
            setServerError(error.message);
            setStep({ kind: "form" });
            return;
          }
          setServerError(
            error instanceof ApiError && error.code === "NETWORK"
              ? "We couldn't reach the office, so we don't know yet if it went through. Tap Send again: it won't be sent twice."
              : error instanceof ApiError
                ? error.message
                : "Something went wrong. Try again.",
          );
        },
      },
    );
  }

  if (step.kind === "done") {
    const w = step.result.withdrawal;
    return (
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: bottom + space[6] }}>
        <View accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: space[3], paddingVertical: space[6] }}>
          <View style={{ width: 64, height: 64, borderRadius: radius.pill, backgroundColor: color.successSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name="check" size={34} color="success" />
          </View>
          <Text variant="title" align="center" accessibilityRole="header">
            Request sent
          </Text>
          <Text variant="body" color="ink2" align="center">
            {w.netCents != null ? `You'll receive ${money(w.netCents)}.` : `You asked for ${money(w.amountCents)}.`}
            {pay.withdrawal.timing ? ` ${pay.withdrawal.timing}` : ""}
          </Text>
        </View>
        <Card padding={4}>
          <MoneyLine label="Left to withdraw" value={money(step.result.availableCents)} strong />
        </Card>
        <Button label="Done" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  if (step.kind === "confirm") {
    const fee = feeCents(step.amountCents, feeBasisPoints);
    return (
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: bottom + space[6] }} keyboardShouldPersistTaps="handled">
        <Text variant="title" accessibilityRole="header">
          Check and send
        </Text>
        <Card padding={4}>
          <View style={{ gap: space[3] }}>
            <MoneyLine label="Taken from your balance" value={money(step.amountCents)} />
            {feeBasisPoints > 0 ? <MoneyLine label={`Processing fee (${percentText(feeBasisPoints)})`} value={`−${money(fee)}`} tone="danger" /> : null}
            <View style={{ height: 1, backgroundColor: color.line }} />
            <MoneyLine label="You'll receive" value={money(step.amountCents - fee)} strong />
          </View>
        </Card>
        {step.note ? (
          <Text variant="small" color="ink2">
            Your note: {step.note}
          </Text>
        ) : null}
        {pay.withdrawal.timing ? (
          <Text variant="small" color="ink2">
            {pay.withdrawal.timing} The office chooses how it's paid.
          </Text>
        ) : null}
        {serverError ? <ErrorBox message={serverError} /> : null}
        <Button
          label={`Send request for ${money(step.amountCents)}`}
          loading={withdraw.isPending}
          onPress={() => send(step.amountCents, step.note)}
        />
        <Button
          label="Change amount"
          variant="secondary"
          disabled={withdraw.isPending}
          onPress={() => {
            setServerError(null);
            setStep({ kind: "form" });
          }}
        />
      </ScrollView>
    );
  }

  const fee = cents != null && !problem ? feeCents(cents, feeBasisPoints) : null;
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: bottom + space[6] }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space[1] }}>
        <Text variant="title" accessibilityRole="header">
          Withdraw
        </Text>
        <Text variant="body" color="ink2">
          You have{" "}
          <Text variant="bodyStrong" color="chrome" numeral>
            {money(available)}
          </Text>{" "}
          available.
        </Text>
      </View>

      <TextField
        label="Amount"
        value={amount}
        onChangeText={(t) => {
          setAmount(t);
          setServerError(null);
        }}
        keyboardType="decimal-pad"
        placeholder="0.00"
        returnKeyType="done"
        // Said as soon as it's wrong, except "enter an amount", which waits for Continue.
        error={touched || (problem && amount.trim() !== "") ? problem : null}
        hint={`At least ${money(minimumCents)}.`}
      />
      <Button
        label={`Withdraw all ${money(available)}`}
        variant="secondary"
        size="md"
        onPress={() => {
          setAmount((available / 100).toFixed(2));
          setTouched(true);
          setServerError(null);
        }}
      />

      {fee != null && cents != null && feeBasisPoints > 0 ? (
        <Card padding={4}>
          <View style={{ gap: space[2] }}>
            <MoneyLine label={`Processing fee (${percentText(feeBasisPoints)})`} value={`−${money(fee)}`} tone="danger" />
            <MoneyLine label="You'll receive" value={money(cents - fee)} strong />
          </View>
        </Card>
      ) : null}

      <TextField
        label="Note for the office (optional)"
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        placeholder="Anything they should know"
      />

      {serverError ? <ErrorBox message={serverError} /> : null}
      <Button label="Continue" onPress={review} />
    </ScrollView>
  );
}


function ErrorBox({ message }: { message: string }) {
  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={{ flexDirection: "row", gap: space[3], padding: space[4], borderRadius: radius.lg, backgroundColor: color.dangerSoft }}
    >
      <Icon name="warning" size={20} color="danger" />
      <Text variant="body" color="danger" style={{ flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}
