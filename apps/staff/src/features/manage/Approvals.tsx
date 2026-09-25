import type { KitRequestItem, ManagedWithdrawal, TimeItem } from "@bookmops/api/v1";
import { Button, Card, Pill, Segmented, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useApprovalsSummary, useDecideKitRequest, useKitRequests, useMe, useTimeItems, useWithdrawalsQueue } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { confirm, errorText, FormError, SectionTitle } from "@/features/record/ui";
import { clockTime, formatMoney, shortDate } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";

import { withdrawalStatus } from "./words";

type Queue = "time" | "withdrawals" | "kit";

/** "Show more" under a paged list, when there is more. */
export function MoreButton({ query }: { query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!query.hasNextPage) return null;
  return <Button label="Show more" variant="secondary" size="md" loading={query.isFetchingNextPage} onPress={() => void query.fetchNextPage()} />;
}

/** "8:31 → 8:12", or "8:31 (unchanged)". */
function change(label: string, from: string | null, to: string | null, timeZone: string): string | null {
  if (!to) return null;
  return `${label} ${from ? clockTime(from, timeZone) : "none"} → ${clockTime(to, timeZone)}`;
}

export function timeChangeLines(t: TimeItem, timeZone: string): string[] {
  return [change("Start", t.current.start, t.requested.start, timeZone), change("Finish", t.current.end, t.requested.end, timeZone)].filter(
    (x): x is string => !!x,
  );
}

function TimeCard({ item, timeZone }: { item: TimeItem; timeZone: string }) {
  const offline = item.kind === "OFFLINE_CLOCK";
  const lines = timeChangeLines(item, timeZone);
  const decided = item.status !== "PENDING";
  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: "/manage/time/[id]", params: { id: item.id } })}
      accessibilityLabel={`${item.cleaner.name}. ${offline ? "Offline clock time" : "Correction request"}. Job ${item.job.jobNumber}. ${lines.join(". ")}${decided ? `. ${item.status === "REJECTED" ? "Rejected" : "Approved"}` : ""}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {item.cleaner.name}
        </Text>
        {decided ? (
          <Pill label={item.status === "REJECTED" ? "Rejected" : "Approved"} tone={item.status === "REJECTED" ? "danger" : "success"} />
        ) : (
          <Pill label={offline ? "Offline tap" : "Correction"} tone={offline ? "warning" : "accent"} />
        )}
      </View>
      <Text variant="small" color="ink2" numberOfLines={1}>
        {[`#${item.job.jobNumber}`, item.job.clientName, shortDate(item.job.startsAt, timeZone)].filter(Boolean).join(" · ")}
      </Text>
      {lines.map((l) => (
        <Text key={l} variant="bodyStrong" color="chrome" numeral style={{ marginTop: space[1] }}>
          {l}
        </Text>
      ))}
    </Card>
  );
}

function TimeQueue({ timeZone }: { timeZone: string }) {
  const pending = useTimeItems("pending");
  const decided = useTimeItems("decided");
  if (pending.isPending) return <Loading label="Loading clock times" />;
  if (pending.isError) return <LoadError error={pending.error} onRetry={() => pending.refetch()} />;
  const items = pending.data.pages.flatMap((p) => p.items);
  const history = decided.data?.pages[0]?.items.slice(0, 5) ?? [];
  return (
    <>
      {items.length === 0 ? (
        <Empty icon="clock" title="No clock times waiting" detail="Offline taps and cleaners' correction requests land here." />
      ) : (
        items.map((t) => <TimeCard key={t.id} item={t} timeZone={timeZone} />)
      )}
      <MoreButton query={pending} />
      {history.length > 0 ? (
        <>
          <SectionTitle>Recently decided</SectionTitle>
          {history.map((t) => (
            <TimeCard key={t.id} item={t} timeZone={timeZone} />
          ))}
        </>
      ) : null}
    </>
  );
}

function WithdrawalCard({ w, timeZone, currency }: { w: ManagedWithdrawal; timeZone: string; currency: string }) {
  const s = withdrawalStatus(w.status);
  const amount = formatMoney(w.amountCents, currency);
  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: "/manage/withdrawals/[id]", params: { id: w.id } })}
      accessibilityLabel={`${w.employee.name}, ${amount}, ${s.label}, requested ${shortDate(w.requestedAt, timeZone)}`}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {w.employee.name}
        </Text>
        <Text variant="subheading" color="chrome" numeral>
          {amount}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginTop: space[1] }}>
        <Pill label={s.label} tone={s.tone} />
        <Text variant="small" color="ink2" numeral style={{ flex: 1 }} numberOfLines={1}>
          Requested {shortDate(w.requestedAt, timeZone)}
          {w.note ? ` · ${w.note}` : ""}
        </Text>
      </View>
    </Card>
  );
}

function WithdrawalQueue({ timeZone, currency }: { timeZone: string; currency: string }) {
  const open = useWithdrawalsQueue("open");
  if (open.isPending) return <Loading label="Loading withdrawals" />;
  if (open.isError) return <LoadError error={open.error} onRetry={() => open.refetch()} />;
  const items = open.data.pages.flatMap((p) => p.items);
  const total = open.data.pages[0]?.openTotalCents ?? 0;
  return items.length === 0 ? (
    <Empty icon="pay" title="No withdrawals to review" />
  ) : (
    <>
      <SectionTitle>{`${items.length} open · ${formatMoney(total, currency)}`}</SectionTitle>
      {items.map((w) => (
        <WithdrawalCard key={w.id} w={w} timeZone={timeZone} currency={currency} />
      ))}
      <MoreButton query={open} />
    </>
  );
}

function KitCard({ item, timeZone }: { item: KitRequestItem; timeZone: string }) {
  const decide = useDecideKitRequest();
  const key = useEventKey();
  const [error, setError] = useState<string | null>(null);
  const what = item.product ? `${item.quantity} ${item.product.unit} of ${item.product.name}` : `${item.kit?.name ?? "A kit"}`;
  const short = !!item.product && item.product.inWarehouse < item.quantity;

  async function run(decision: "APPROVE" | "REJECT") {
    if (decide.isPending) return;
    setError(null);
    const ok = await confirm({
      title: decision === "APPROVE" ? `Approve ${item.employee.name}'s request?` : `Reject ${item.employee.name}'s request?`,
      message:
        decision === "APPROVE"
          ? item.product
            ? `${what} moves from the warehouse into their kit.`
            : "It's marked approved. Hand out the kit from the web console."
          : undefined,
      confirmLabel: decision === "APPROVE" ? "Approve" : "Reject",
      destructive: decision === "REJECT",
    });
    if (!ok) return;
    const body = { decision };
    decide.mutate(
      { id: item.id, body: { ...body, clientEventId: key.for({ id: item.id, ...body }) } },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
        onError: (e) => {
          key.failed(e);
          setError(errorText(e));
        },
      },
    );
  }

  return (
    <Card padding={4}>
      <View style={{ gap: space[1] }} accessible accessibilityLabel={`${item.employee.name} asks for ${what}${item.reason ? `. ${item.reason}` : ""}`}>
        <Text variant="bodyStrong">{item.employee.name}</Text>
        <Text variant="body" numeral>
          {what}
        </Text>
        <Text variant="small" color="ink2" numeral>
          {[shortDate(item.requestedAt, timeZone), item.reason].filter(Boolean).join(" · ")}
        </Text>
        {item.product ? (
          <View style={{ flexDirection: "row", marginTop: space[1] }}>
            <Pill label={`${item.product.inWarehouse} in the warehouse`} tone={short ? "danger" : "neutral"} />
          </View>
        ) : null}
      </View>
      <FormError message={error} />
      <View style={{ flexDirection: "row", gap: space[2], marginTop: space[3] }}>
        <Button label="Reject" variant="danger" size="md" style={{ flex: 1 }} disabled={decide.isPending} onPress={() => void run("REJECT")} />
        <Button label="Approve" size="md" style={{ flex: 1 }} loading={decide.isPending} onPress={() => void run("APPROVE")} />
      </View>
    </Card>
  );
}

function KitQueue({ timeZone }: { timeZone: string }) {
  const kit = useKitRequests();
  if (kit.isPending) return <Loading label="Loading kit requests" />;
  if (kit.isError) return <LoadError error={kit.error} onRetry={() => kit.refetch()} />;
  const items = kit.data.pages.flatMap((p) => p.items);
  return items.length === 0 ? (
    <Empty icon="kit" title="No kit requests waiting" />
  ) : (
    <>
      {items.map((k) => (
        <KitCard key={k.id} item={k} timeZone={timeZone} />
      ))}
      <MoreButton query={kit} />
    </>
  );
}

/** How many are waiting across the queues this role can act on, for a tab's badge. */
export function useApprovalsCount(): number | undefined {
  const s = useApprovalsSummary().data;
  if (!s) return undefined;
  return (s.time ?? 0) + (s.withdrawals ?? 0) + (s.kit ?? 0);
}

/**
 * The approval queues the role may act on, one at a time: clock times for
 * every manager role and field leads; withdrawals and kit for owners and
 * admins. A queue the role can't use isn't offered at all.
 */
export function ApprovalsBody() {
  const me = useMe();
  const role = useStaffRole();
  const summary = useApprovalsSummary();
  const s = summary.data;
  const label = (name: string, n: number | null | undefined) => (n ? `${name} ${n}` : name);
  const queues = [
    role.can("TIME_APPROVE") ? { value: "time" as const, label: label("Clock", s?.time) } : null,
    role.can("WITHDRAWALS") ? { value: "withdrawals" as const, label: label("Pay", s?.withdrawals) } : null,
    role.can("KIT_REQUESTS") ? { value: "kit" as const, label: label("Kit", s?.kit) } : null,
  ].filter((q): q is { value: Queue; label: string } => !!q);
  const [picked, setPicked] = useState<Queue | null>(null);
  const queue = picked ?? queues[0]?.value ?? "time";
  const tz = me.data?.company.timezone;
  const currency = me.data?.company.currency ?? "CAD";

  if (!tz) return me.isError ? <LoadError error={me.error} onRetry={() => me.refetch()} /> : <Loading label="Loading approvals" />;
  return (
    <>
      {queues.length > 1 ? <Segmented label="Which approvals" options={queues} value={queue} onChange={setPicked} /> : null}
      {queue === "time" ? <TimeQueue timeZone={tz} /> : queue === "withdrawals" ? <WithdrawalQueue timeZone={tz} currency={currency} /> : <KitQueue timeZone={tz} />}
    </>
  );
}
