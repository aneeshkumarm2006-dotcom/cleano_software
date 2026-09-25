import { KIT_MAX_QUANTITY } from "@bookmops/api/v1";
import { parseQuantityInput } from "@bookmops/core/validation";
import { Button, color, Icon, minTouch, radius, space, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useAddKitItem, useKitCatalog } from "@/data/queries";
import { BackHeader, errorText, FormError, goBack, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

/**
 * Supplies the cleaner already has (a starting kit), without waiting for the
 * office to assign them. Only products not yet in the kit are offered.
 */
export default function AddKitItem() {
  const catalog = useKitCatalog();
  const add = useAddKitItem();
  const key = useEventKey();
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [error, setError] = useState<{ message: string; field?: "qty" } | null>(null);

  const all = catalog.data?.items ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  const chosen = all.find((p) => p.productId === productId) ?? null;

  function submit() {
    if (add.isPending) return;
    if (!chosen) return setError({ message: "Pick what you have." });
    const parsed = parseQuantityInput(qty, { min: 1, max: KIT_MAX_QUANTITY });
    if (!parsed.ok) return setError({ message: parsed.error, field: "qty" });
    setError(null);
    const body = { productId: chosen.productId, quantity: parsed.value };
    add.mutate(
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
      header={<BackHeader title="Add what you have" />}
      footer={
        all.length > 0 ? (
          <>
            {!error?.field ? <FormError message={error?.message} /> : null}
            <Button label={chosen ? `Add ${chosen.name}` : "Add to my kit"} loading={add.isPending} onPress={submit} />
          </>
        ) : undefined
      }
    >
      {catalog.isPending ? (
        <Loading />
      ) : catalog.isError ? (
        <LoadError error={catalog.error} onRetry={() => catalog.refetch()} />
      ) : all.length === 0 ? (
        <Empty icon="kit" title="Nothing left to add" detail="Everything the company stocks is already in your kit." />
      ) : (
        <>
          <Text variant="body" color="ink2">
            Record supplies you already have. The office sees it in the stock history.
          </Text>
          {chosen ? (
            <TextField
              label={`How many ${chosen.unit}?`}
              value={qty}
              onChangeText={setQty}
              keyboardType="number-pad"
              placeholder="e.g. 2"
              error={error?.field === "qty" ? error.message : null}
              autoFocus
            />
          ) : null}
          <TextField label="Find a product" value={search} onChangeText={setSearch} placeholder="Spray, gloves, mop…" autoCorrect={false} />
          <View accessibilityRole="radiogroup" accessibilityLabel="Product" style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
            {shown.length === 0 ? (
              <Text variant="small" color="ink2" style={{ padding: space[4] }}>
                Nothing matches “{search.trim()}”.
              </Text>
            ) : (
              shown.map((p, i) => {
                const selected = p.productId === productId;
                return (
                  <Pressable
                    key={p.productId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${p.name}, in ${p.unit}`}
                    onPress={() => setProductId(p.productId)}
                    style={({ pressed }) => ({
                      minHeight: minTouch + 6,
                      paddingHorizontal: space[4],
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space[3],
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: color.line,
                      backgroundColor: selected ? color.accentSoft : pressed ? color.groundDeep : color.surface,
                    })}
                  >
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      {p.name}
                    </Text>
                    <Text variant="small" color="ink3">
                      {p.unit}
                    </Text>
                    {selected ? <Icon name="check" size={20} color="accentText" /> : null}
                  </Pressable>
                );
              })
            )}
          </View>
        </>
      )}
    </Page>
  );
}
