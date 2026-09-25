import { KIT_MAX_QUANTITY } from "@bookmops/api/v1";
import { parseQuantityInput } from "@bookmops/core/validation";
import { Button, space, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitItem, useSetKitCount } from "@/data/queries";
import { amount } from "@/features/kit/display";
import { BackHeader, errorText, FormError, goBack, Notice, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

/**
 * A recount: the true number in the kit, and why it changed. The box starts
 * empty on purpose (the web's fix for a stuck "1"): the number on record is
 * shown above it to check against, not put under the cursor to delete.
 */
export default function Recount() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const kit = useKitItem(productId);
  const save = useSetKitCount(productId);
  const key = useEventKey();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ message: string; field?: "qty" | "reason" } | null>(null);
  const item = kit.item;

  function submit() {
    if (!item || save.isPending) return;
    const parsed = parseQuantityInput(qty, { min: 0, max: KIT_MAX_QUANTITY });
    if (!parsed.ok) return setError({ message: parsed.error, field: "qty" });
    if (!reason.trim()) return setError({ message: "Say why the count changed. The office sees it with the new number.", field: "reason" });
    setError(null);
    const body = { quantity: parsed.value, reason: reason.trim() };
    save.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBack();
        },
        onError: (e) => {
          key.failed(e);
          setError({ message: errorText(e) });
        },
      },
    );
  }

  return (
    <Page
      header={<BackHeader title="Recount" subtitle={item?.name} />}
      footer={item ? <Button label="Save the count" loading={save.isPending} onPress={submit} /> : undefined}
    >
      {kit.isPending ? (
        <Loading />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : !item ? (
        <Empty icon="kit" title="Not in your kit" />
      ) : (
        <>
          <Text variant="body" color="ink2">
            On record: <Text variant="bodyStrong" numeral>{amount(item)}</Text>. Count what you actually have.
          </Text>
          <TextField
            label={`How many ${item.unit} do you have?`}
            value={qty}
            onChangeText={setQty}
            keyboardType="number-pad"
            placeholder={`e.g. ${Math.round(item.quantity)}`}
            error={error?.field === "qty" ? error.message : null}
            selectTextOnFocus
            autoFocus
          />
          <TextField
            label="Why is it different?"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. two bottles were already empty"
            maxLength={300}
            multiline
            error={error?.field === "reason" ? error.message : null}
          />
          {!error?.field ? <FormError message={error?.message} /> : null}
          <Notice tone="neutral" icon="info">
            Lost, broken or used up? Report a problem instead, so the office's stock is right too.
          </Notice>
          <View>
            <Button
              label="Report a problem"
              variant="secondary"
              size="md"
              icon="flag"
              onPress={() => router.replace({ pathname: "/kit/[productId]/issue", params: { productId } })}
            />
          </View>
        </>
      )}
    </Page>
  );
}
