import { KIT_ISSUE_TYPES, KIT_MAX_QUANTITY, type KitIssueType } from "@bookmops/api/v1";
import { ISSUE_HINT, ISSUE_LABEL, needsRestock, writesOffCompanyStock } from "@bookmops/core/inventory";
import { parseQuantityInput } from "@bookmops/core/validation";
import { Button, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitItem, useReportKitIssue } from "@/data/queries";
import { amount } from "@/features/kit/display";
import { OptionList } from "@/features/record/OptionList";
import { BackHeader, confirm, errorText, FormError, goBack, Notice, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

const OPTIONS = KIT_ISSUE_TYPES.map((t) => ({ value: t, label: ISSUE_LABEL[t], hint: ISSUE_HINT[t] }));

/** What each kind of problem does, in the web's words, so the right one gets picked. */
function effect(type: KitIssueType): string {
  if (writesOffCompanyStock(type)) return "This takes it out of your kit, writes it off the company's stock, and tells the office.";
  if (needsRestock(type)) return "This takes it out of your kit and tells the office you may need a restock.";
  return "This takes it out of your kit and flags it for the office to look at.";
}

/** Something happened to an item: lost, broken, ran out, or something else. */
export default function ReportIssue() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const kit = useKitItem(productId);
  const report = useReportKitIssue(productId);
  const key = useEventKey();
  const [type, setType] = useState<KitIssueType>("LOST");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ message: string; field?: "qty" } | null>(null);
  const item = kit.item;

  async function submit() {
    if (!item || report.isPending) return;
    const max = Math.min(KIT_MAX_QUANTITY, Math.floor(item.quantity));
    const parsed = parseQuantityInput(qty, { min: 1, max, unit: item.unit });
    if (!parsed.ok) return setError({ message: parsed.error, field: "qty" });
    setError(null);
    const ok = await confirm({
      title: `${ISSUE_LABEL[type]}: ${parsed.value} ${item.unit}?`,
      message: effect(type),
      confirmLabel: "Report it",
      destructive: writesOffCompanyStock(type),
    });
    if (!ok) return;
    const body = { type, quantity: parsed.value, note: note.trim() || null };
    report.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBack();
        },
        onError: (e) => setError({ message: errorText(e) }),
      },
    );
  }

  return (
    <Page
      header={<BackHeader title="Report a problem" subtitle={item?.name} />}
      footer={item && item.quantity > 0 ? <Button label="Report it" variant="danger" loading={report.isPending} onPress={submit} /> : undefined}
    >
      {kit.isPending ? (
        <Loading />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : !item ? (
        <Empty icon="kit" title="Not in your kit" />
      ) : item.quantity <= 0 ? (
        <Empty icon="kit" title="None left to report" detail="Your kit has none of this. Ask for a restock instead." />
      ) : (
        <>
          <OptionList label="What happened?" options={OPTIONS} value={type} onChange={setType} columns={2} />
          <Notice tone={writesOffCompanyStock(type) ? "warn" : "neutral"} icon="info">
            {effect(type)}
          </Notice>
          <TextField
            label={`How many? You have ${amount(item)}`}
            value={qty}
            onChangeText={setQty}
            keyboardType="number-pad"
            placeholder="e.g. 1"
            error={error?.field === "qty" ? error.message : null}
            selectTextOnFocus
          />
          <TextField
            label="What happened? (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. the nozzle broke at the Duluth job"
            maxLength={300}
            multiline
          />
          {!error?.field ? <FormError message={error?.message} /> : null}
          <Text variant="small" color="ink3">
            The office sees this in the stock history, with your name and the time.
          </Text>
        </>
      )}
    </Page>
  );
}
