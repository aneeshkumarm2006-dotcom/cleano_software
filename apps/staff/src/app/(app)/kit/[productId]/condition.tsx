import { KIT_CONDITIONS, type KitCondition } from "@bookmops/api/v1";
import { EQUIPMENT_CONDITION_HINT, EQUIPMENT_CONDITION_LABEL } from "@bookmops/core/inventory";
import { Button, TextField, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitItem, useSetKitCondition } from "@/data/queries";
import { isTool } from "@/features/kit/display";
import { OptionList } from "@/features/record/OptionList";
import { BackHeader, errorText, FormError, goBack, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

const OPTIONS = KIT_CONDITIONS.map((c) => ({ value: c, label: EQUIPMENT_CONDITION_LABEL[c], hint: EQUIPMENT_CONDITION_HINT[c] }));

/** How a tool is. Nothing is taken out of the kit; the office sees the report. */
export default function Condition() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const kit = useKitItem(productId);
  const save = useSetKitCondition(productId);
  const key = useEventKey();
  const item = kit.item;
  const current = item?.condition && item.condition !== "UNKNOWN" ? item.condition : "AVAILABLE";
  const [choice, setChoice] = useState<KitCondition | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = choice ?? current;
  const noteValue = note ?? item?.statusNote ?? "";

  function submit() {
    if (!item || save.isPending) return;
    setError(null);
    const body = { condition: value, note: noteValue.trim() || null };
    save.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBack();
        },
        onError: (e) => setError(errorText(e)),
      },
    );
  }

  return (
    <Page
      header={<BackHeader title="Condition" subtitle={item?.name} />}
      footer={item && isTool(item) ? <Button label="Save" loading={save.isPending} onPress={submit} /> : undefined}
    >
      {kit.isPending ? (
        <Loading />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : !item || !isTool(item) ? (
        <Empty icon="tool" title="Not a tool" detail="Only tools have a condition. Recount this item instead." />
      ) : (
        <>
          <Text variant="body" color="ink2">
            How is it? Nothing is taken out of your kit. Anything but “Available” goes to the office to sort out.
          </Text>
          <OptionList label={`Condition of ${item.name}`} options={OPTIONS} value={value} onChange={setChoice} />
          <TextField
            label="Note (optional)"
            value={noteValue}
            onChangeText={setNote}
            placeholder="e.g. handle cracked, still usable for now"
            maxLength={300}
            multiline
          />
          <FormError message={error} />
        </>
      )}
    </Page>
  );
}
