import type { KitItem, KitRestockResponse } from "@bookmops/api/v1";
import { Button, Checkbox, color, radius, space, Stepper, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useKit, useMe, useRequestRestock } from "@/data/queries";
import { amount, canRestock, suggestedRestock } from "@/features/kit/display";
import { BackHeader, errorText, FormError, goBack, Notice, Page, quantityText, SectionTitle } from "@/features/record/ui";
import { dayMonth } from "@/lib/dates";
import { useEventKey } from "@/lib/idempotency";

/**
 * Ask the office for more. Items running low are ticked to start with, at the
 * amount that tops them back up; anything already asked for is shown, not
 * asked for twice.
 */
export default function Restock() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const me = useMe();
  const kit = useKit();
  const tz = me.data?.company.timezone;
  const send = useRequestRestock();
  const key = useEventKey();
  const [picked, setPicked] = useState<Record<string, number> | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KitRestockResponse | null>(null);

  const items = (kit.data?.items ?? []).filter(canRestock);
  const open = items.filter((i) => !i.pendingRequest);
  const asked = items.filter((i) => i.pendingRequest);
  // What starts ticked: the item this was opened from, or everything low.
  const initial = (): Record<string, number> =>
    Object.fromEntries(
      open.filter((i) => (productId ? i.productId === productId : i.attention.needsAttention)).map((i) => [i.productId, suggestedRestock(i)]),
    );
  const lines = picked ?? initial();
  const count = Object.keys(lines).length;

  function toggle(item: KitItem, on: boolean) {
    const next = { ...lines };
    if (on) next[item.productId] = suggestedRestock(item);
    else delete next[item.productId];
    setPicked(next);
  }

  function submit() {
    if (count === 0 || send.isPending) return;
    setError(null);
    const body = {
      items: Object.entries(lines).map(([id, quantity]) => ({ productId: id, quantity })),
      note: note.trim() || null,
    };
    send.mutate(
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
    const created = result.results.filter((r) => r.outcome === "CREATED").length;
    const already = result.results.length - created;
    return (
      <Page header={<BackHeader title="Restock" />} footer={<Button label="Done" onPress={goBack} />}>
        <Notice tone="ok" icon="check" title="Sent to the office">
          {`${created} ${created === 1 ? "item" : "items"} requested. The office will top you up.`}
        </Notice>
        {already > 0 ? (
          <Notice tone="neutral" icon="info">
            {`${already} ${already === 1 ? "was" : "were"} already on order, so ${already === 1 ? "it wasn't" : "they weren't"} asked for again.`}
          </Notice>
        ) : null}
      </Page>
    );
  }

  return (
    <Page
      header={<BackHeader title="Request a restock" />}
      footer={
        items.length > 0 ? (
          <>
            <FormError message={error} />
            <Button
              label={count === 0 ? "Pick what you need" : `Ask for ${count} ${count === 1 ? "item" : "items"}`}
              disabled={count === 0}
              loading={send.isPending}
              onPress={submit}
            />
          </>
        ) : undefined
      }
    >
      {kit.isPending || !tz ? (
        <Loading />
      ) : kit.isError ? (
        <LoadError error={kit.error} onRetry={() => kit.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon="kit" title="Nothing to restock" detail="Your kit has no supplies that run out. Tools are repaired or replaced instead: report a problem on the tool." />
      ) : (
        <>
          <Text variant="body" color="ink2">
            Tick what you need and how many. The office gets one request and tops you up from storage.
          </Text>
          {open.length > 0 ? (
            <View style={{ gap: space[2] }}>
              {open.map((item) => {
                const on = lines[item.productId] != null;
                return (
                  <View
                    key={item.productId}
                    style={{
                      padding: space[4],
                      gap: space[3],
                      borderRadius: radius.lg,
                      borderWidth: 1,
                      borderColor: on ? color.lineStrong : color.line,
                      backgroundColor: color.surface,
                    }}
                  >
                    <Checkbox
                      checked={on}
                      onChange={(v) => toggle(item, v)}
                      accessibilityLabel={`${item.name}, ${item.attention.label}, you have ${amount(item)}`}
                    >
                      <Text variant="bodyStrong">{item.name}</Text>
                      <Text variant="small" color={item.attention.needsAttention ? "warning" : "ink2"} numeral>
                        {item.attention.label} · you have {amount(item)}
                      </Text>
                    </Checkbox>
                    {on ? (
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 36 }}>
                        <Text variant="small" color="ink2">
                          How many?
                        </Text>
                        <Stepper
                          label={item.name}
                          unit={item.unit}
                          min={1}
                          max={1000}
                          value={lines[item.productId]!}
                          onChange={(v) => setPicked({ ...lines, [item.productId]: v })}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}
          {asked.length > 0 ? (
            <>
              <SectionTitle>Already asked for</SectionTitle>
              {asked.map((item) => (
                <Text key={item.productId} variant="small" color="ink2" numeral>
                  {item.name}: {quantityText(item.pendingRequest!.quantity)} {item.unit} on {dayMonth(item.pendingRequest!.requestedAt, tz)}
                </Text>
              ))}
            </>
          ) : null}
          <TextField
            label="Note for the office (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. I need it before Friday's deep clean"
            maxLength={300}
            multiline
          />
        </>
      )}
    </Page>
  );
}
