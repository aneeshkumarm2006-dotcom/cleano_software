import type { KitPickupResponse } from "@bookmops/api/v1";
import { Button, color, radius, space, Stepper, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKitLocationProducts, usePickUp } from "@/data/queries";
import { BackHeader, confirm, errorText, FormError, Notice, Page, quantityText } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

/**
 * Picking up, step two: what are you taking? Every product is listed, even
 * one the shelf count says is out (the count is an estimate, and the web never
 * blocks a pickup on it). Confirmed before it's recorded.
 */
export default function Pickup() {
  const { locationId } = useLocalSearchParams<{ locationId: string }>();
  const products = useKitLocationProducts(locationId);
  const pickUp = usePickUp();
  const key = useEventKey();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KitPickupResponse | null>(null);

  const location = products.data?.location;
  const all = products.data?.items ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  const lines = Object.entries(cart).filter(([, n]) => n > 0);

  async function submit() {
    if (lines.length === 0 || pickUp.isPending) return;
    setError(null);
    const summary = lines
      .map(([id, n]) => {
        const p = all.find((x) => x.productId === id);
        return `${n} ${p?.unit ?? ""} ${p?.name ?? ""}`.replace(/\s+/g, " ").trim();
      })
      .join("\n");
    const ok = await confirm({ title: `Take these from ${location?.name ?? "storage"}?`, message: summary, confirmLabel: "Record pickup" });
    if (!ok) return;
    const body = { locationId, items: lines.map(([productId, quantity]) => ({ productId, quantity })), note: note.trim() || null };
    pickUp.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: (res) => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setResult(res);
        },
        onError: (e) => {
          key.failed(e);
          setError(errorText(e));
        },
      },
    );
  }

  if (result) {
    return (
      <Page header={<BackHeader title="Picked up" />} footer={<Button label="Back to my kit" onPress={() => router.dismissTo("/kit")} />}>
        <Notice tone="ok" icon="check" title="Added to your kit">
          {`${lines.length} ${lines.length === 1 ? "item is" : "items are"} now in your kit.`}
        </Notice>
        {result.warnings.length > 0 ? (
          <Notice tone="warn" icon="info" title="The office will check the shelf">
            {result.warnings.join("\n")}
          </Notice>
        ) : null}
      </Page>
    );
  }

  return (
    <Page
      header={<BackHeader title={location?.name ?? "Pick up"} subtitle={location?.address ?? undefined} />}
      footer={
        all.length > 0 ? (
          <>
            <FormError message={error} />
            <Button
              label={lines.length === 0 ? "Choose what you're taking" : `Take ${lines.length} ${lines.length === 1 ? "item" : "items"}`}
              disabled={lines.length === 0}
              loading={pickUp.isPending}
              onPress={submit}
            />
          </>
        ) : undefined
      }
    >
      {products.isPending ? (
        <Loading />
      ) : products.isError ? (
        <LoadError error={products.error} onRetry={() => products.refetch()} />
      ) : all.length === 0 ? (
        <Empty icon="kit" title="Nothing stocked" detail="The company has no products set up yet." />
      ) : (
        <>
          <TextField label="Find a product" value={search} onChangeText={setSearch} placeholder="Spray, gloves, mop…" autoCorrect={false} />
          <View style={{ backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
            {shown.length === 0 ? (
              <Text variant="small" color="ink2" style={{ padding: space[4] }}>
                Nothing matches “{search.trim()}”.
              </Text>
            ) : (
              shown.map((p, i) => {
                const n = cart[p.productId] ?? 0;
                return (
                  <View
                    key={p.productId}
                    style={{
                      padding: space[4],
                      gap: space[2],
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: color.line,
                      backgroundColor: n > 0 ? color.accentSofter : color.surface,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong">{p.name}</Text>
                        <Text variant="small" color={p.available > 0 ? "ink2" : "warning"} numeral>
                          {p.available > 0 ? `${quantityText(p.available)} ${p.unit} on the shelf` : "The shelf count says none"}
                        </Text>
                      </View>
                      <Stepper label={p.name} min={0} max={1000} value={n} onChange={(v) => setCart((c) => ({ ...c, [p.productId]: v }))} />
                    </View>
                  </View>
                );
              })
            )}
          </View>
          <TextField label="Note for the office (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
        </>
      )}
    </Page>
  );
}
