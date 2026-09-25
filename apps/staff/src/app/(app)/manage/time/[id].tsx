import { DECISION_NOTE_MAX, type TimeDecision, type TimeItem } from "@bookmops/api/v1";
import { Button, Card, Pill, Segmented, space, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { type Href, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { goBackOr } from "@/components/BackButton";
import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { useDecideTime, useMe, useTimeItem } from "@/data/queries";
import { useStaffRole } from "@/data/role";
import { TimeStepper } from "@/features/manage/TimeStepper";
import { ALREADY_HANDLED, handledElsewhere, OFFLINE_EVENT, OFFLINE_WHY } from "@/features/manage/words";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle } from "@/features/record/ui";
import { clockTime, shortDate } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";

const DECISIONS = [
  { value: "APPROVE", label: "Approve" },
  { value: "ADJUST", label: "Adjust" },
  { value: "REJECT", label: "Reject" },
] as const satisfies readonly { value: TimeDecision; label: string }[];

/**
 * One clock time waiting on the office: an offline tap the server couldn't
 * take at its word (API_V1.md §6), or a cleaner's own correction request.
 * Approve applies what was asked; Adjust applies the time the office knows
 * is right; Reject leaves the record as it is. Adjusting or rejecting needs
 * a note, which the cleaner sees. A field lead approves or rejects only:
 * Adjust isn't offered without TIME_ADJUST, and the server refuses it too.
 * Nobody is shown their own time (the server leaves it out of the queue).
 */
export default function TimeItemScreen() {
  return (
    <Guarded need="TIME_APPROVE">
      <TimeItemView />
    </Guarded>
  );
}

function TimeItemView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const role = useStaffRole();
  const item = useTimeItem(id);
  const tz = me.data?.company.timezone;
  const header = (
    <BackHeader
      title="Clock time"
      subtitle={item.data?.cleaner.name}
      fallback={role.side === "office" ? "/manage/approvals" : "/manage/queue"}
      backLabel="Back to approvals"
    />
  );
  if (item.isPending || !tz) {
    return (
      <Page header={header}>
        <Loading label="Loading clock time" />
      </Page>
    );
  }
  if (item.isError) {
    return (
      <Page header={header}>
        <LoadError error={item.error} onRetry={() => item.refetch()} />
      </Page>
    );
  }
  return (
    <Decide
      header={header}
      item={item.data}
      timeZone={tz}
      canAdjust={role.can("TIME_ADJUST")}
      back={role.side === "office" ? "/manage/approvals" : "/manage/queue"}
    />
  );
}

function Row({ label, now, asked, timeZone }: { label: string; now: string | null; asked: string | null; timeZone: string }) {
  const nowText = now ? clockTime(now, timeZone) : "—";
  const askedText = asked ? clockTime(asked, timeZone) : "No change";
  return (
    <View accessible accessibilityLabel={`${label}: on record ${nowText}, asked for ${askedText}`} style={{ flexDirection: "row", alignItems: "baseline", gap: space[3] }}>
      <Text variant="eyebrow" color="ink3" style={{ width: 56 }}>
        {label}
      </Text>
      <Text variant="heading" color="chrome" numeral style={{ flex: 1 }}>
        {nowText}
      </Text>
      <Text variant="heading" color={asked ? "warning" : "ink3"} numeral style={{ flex: 1 }}>
        {askedText}
      </Text>
    </View>
  );
}

function Decide({
  header,
  item,
  timeZone,
  canAdjust,
  back,
}: {
  header: ReactNode;
  item: TimeItem;
  timeZone: string;
  canAdjust: boolean;
  back: Href;
}) {
  const decide = useDecideTime(item.id);
  const key = useEventKey();
  const options = canAdjust ? DECISIONS : DECISIONS.filter((d) => d.value !== "ADJUST");
  const [decision, setDecision] = useState<TimeDecision>("APPROVE");
  const [handled, setHandled] = useState(false);
  const [start, setStart] = useState(item.requested.start ?? item.current.start);
  const [end, setEnd] = useState(item.requested.end ?? item.current.end);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = item.status === "PENDING";
  const needsNote = decision !== "APPROVE";
  const badOrder = decision === "ADJUST" && !!start && !!end && end <= start;

  async function submit() {
    if (decide.isPending) return;
    setError(null);
    if (needsNote && !note.trim()) {
      setError("Add a note for the cleaner: they'll see why.");
      return;
    }
    if (badOrder) return;
    const title =
      decision === "APPROVE"
        ? `Approve ${item.cleaner.name}'s time?`
        : decision === "ADJUST"
          ? "Save these times?"
          : `Reject ${item.cleaner.name}'s time?`;
    const message =
      decision === "APPROVE"
        ? "Their hours are corrected to what they asked for, and payroll uses the new times."
        : decision === "ADJUST"
          ? `Start ${start ? clockTime(start, timeZone) : "—"}, finish ${end ? clockTime(end, timeZone) : "still running"}. Payroll uses these times.`
          : "Nothing changes on their record. They'll see your note.";
    const ok = await confirm({ title, message, confirmLabel: decision === "REJECT" ? "Reject" : "Save", destructive: decision === "REJECT" });
    if (!ok) return;
    const body = {
      decision,
      ...(decision === "ADJUST" ? { start, end } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    decide.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBackOr(back);
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
      },
    );
  }

  const offline = item.offline;
  return (
    <Page
      header={header}
      footer={
        pending ? (
          <>
            <FormError message={badOrder ? "The finish has to be after the start." : error} />
            <Button
              label={decision === "APPROVE" ? "Approve" : decision === "ADJUST" ? "Save adjusted times" : "Reject"}
              variant={decision === "REJECT" ? "danger" : "primary"}
              loading={decide.isPending}
              disabled={badOrder}
              onPress={() => void submit()}
            />
          </>
        ) : undefined
      }
    >
      {handled ? (
        <Notice tone="neutral" icon="info">
          {ALREADY_HANDLED}
        </Notice>
      ) : null}
      <Card padding={4}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {item.cleaner.name}
          </Text>
          <Pill label={offline ? "Offline tap" : "Correction"} tone={offline ? "warning" : "accent"} />
        </View>
        <Text variant="small" color="ink2" numeral>
          {[`Job #${item.job.jobNumber}`, item.job.clientName, `${shortDate(item.job.startsAt, timeZone)} ${clockTime(item.job.startsAt, timeZone)}`]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </Card>

      {offline ? (
        <Notice tone="warn" icon="clock" title={`${OFFLINE_EVENT[offline.event] ?? "A clock tap"} sent from offline`}>
          {`${OFFLINE_WHY[offline.why] ?? "The office decides which time counts."} Tapped at ${clockTime(offline.occurredAt, timeZone)}, arrived at ${clockTime(offline.receivedAt, timeZone)}. The arrival time applies until you decide.`}
        </Notice>
      ) : item.reason ? (
        <Notice tone="neutral" icon="chat" title="Their reason">
          {item.reason}
        </Notice>
      ) : null}

      <Card padding={4}>
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <View style={{ width: 56 }} />
            <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
              On record
            </Text>
            <Text variant="eyebrow" color="ink3" style={{ flex: 1 }}>
              Asked for
            </Text>
          </View>
          <Row label="Start" now={item.current.start} asked={item.requested.start} timeZone={timeZone} />
          <Row label="Finish" now={item.current.end} asked={item.requested.end} timeZone={timeZone} />
        </View>
      </Card>

      {pending ? (
        <>
          <Segmented label="Your decision" options={options} value={decision} onChange={(d) => { setDecision(d); setError(null); }} />
          {decision === "ADJUST" ? (
            <>
              <SectionTitle>The right times</SectionTitle>
              <Card padding={4}>
                <View style={{ gap: space[4] }}>
                  {start ? <TimeStepper label="Start" value={start} onChange={setStart} timeZone={timeZone} /> : null}
                  {end ? (
                    <TimeStepper label="Finish" value={end} onChange={setEnd} timeZone={timeZone} />
                  ) : (
                    <Text variant="small" color="ink2">
                      No finish yet: they're still clocked in.
                    </Text>
                  )}
                </View>
              </Card>
            </>
          ) : null}
          <TextField
            label={needsNote ? "Note for the cleaner" : "Note for the cleaner (optional)"}
            value={note}
            onChangeText={(t) => {
              setNote(t);
              setError(null);
            }}
            multiline
            maxLength={DECISION_NOTE_MAX}
            hint={needsNote ? "They'll see this with the decision." : undefined}
          />
        </>
      ) : item.decided ? (
        <Notice tone={item.status === "REJECTED" ? "critical" : "ok"} icon={item.status === "REJECTED" ? "close" : "check"} title={`${item.status === "REJECTED" ? "Rejected" : "Approved"} by ${item.decided.by}`}>
          {`${shortDate(item.decided.at, timeZone)} ${clockTime(item.decided.at, timeZone)}${item.decided.note ? ` · ${item.decided.note}` : ""}`}
        </Notice>
      ) : null}
    </Page>
  );
}
