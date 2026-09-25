import { type ManagedIssue, MAX_ISSUE_NOTE } from "@bookmops/api/v1";
import { Button, Card, Pill, radius, space, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { Guarded } from "@/components/Guarded";
import { LoadError, Loading } from "@/components/QueryState";
import { useIssue, useMe, useSetIssueStatus } from "@/data/queries";
import { issueCategory, issueStatus } from "@/features/manage/words";
import { BackHeader, confirm, errorText, FormError, Notice, Page } from "@/features/record/ui";
import { clockTime, shortDate } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";
import { safeWebUrl } from "@/lib/urls";

/**
 * A problem a cleaner reported, and the office's answer. Acknowledge says
 * someone has it; Resolve closes it with a note the cleaner sees on their
 * report; Reopen undoes a resolve, as on the web's Issues page.
 */
export default function IssueScreen() {
  return (
    <Guarded need="ISSUES">
      <IssueView />
    </Guarded>
  );
}

function IssueView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const issue = useIssue(id);
  const tz = me.data?.company.timezone;
  const header = <BackHeader title="Problem report" subtitle={issue.data ? `Job #${issue.data.job.jobNumber}` : undefined} fallback="/manage/alerts" />;
  if (issue.isPending || !tz) {
    return (
      <Page header={header}>
        <Loading label="Loading the report" />
      </Page>
    );
  }
  if (issue.isError) {
    return (
      <Page header={header}>
        <LoadError error={issue.error} onRetry={() => issue.refetch()} />
      </Page>
    );
  }
  return <Handle header={header} issue={issue.data} timeZone={tz} />;
}

function Handle({ header, issue, timeZone }: { header: ReactNode; issue: ManagedIssue; timeZone: string }) {
  const set = useSetIssueStatus(issue.id);
  const key = useEventKey();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = issueStatus(issue.status);
  const resolved = issue.status === "RESOLVED";
  const photo = issue.photoUrl ? safeWebUrl(issue.photoUrl) : null;

  async function move(status: "ACKNOWLEDGED" | "RESOLVED" | "OPEN") {
    if (set.isPending) return;
    setError(null);
    if (status === "RESOLVED" && !note.trim()) {
      setError("Say what was done. The cleaner sees this on their report.");
      return;
    }
    if (status !== "ACKNOWLEDGED") {
      const ok = await confirm(
        status === "RESOLVED"
          ? { title: "Mark this resolved?", message: `${issue.reportedBy} sees your note.`, confirmLabel: "Resolve" }
          : { title: "Reopen this report?", message: "The resolution note is cleared.", confirmLabel: "Reopen" },
      );
      if (!ok) return;
    }
    const body = { status, ...(status === "RESOLVED" ? { resolutionNote: note.trim() } : {}) };
    set.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          setNote("");
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
    <Page
      header={header}
      footer={
        <>
          <FormError message={error} />
          {resolved ? (
            <Button label="Reopen" variant="secondary" loading={set.isPending} onPress={() => void move("OPEN")} />
          ) : (
            <View style={{ flexDirection: "row", gap: space[2] }}>
              {issue.status === "OPEN" ? (
                <Button label="Acknowledge" variant="secondary" size="md" style={{ flex: 1 }} disabled={set.isPending} onPress={() => void move("ACKNOWLEDGED")} />
              ) : null}
              <Button label="Resolve" size="md" style={{ flex: 1 }} loading={set.isPending} onPress={() => void move("RESOLVED")} />
            </View>
          )}
        </>
      }
    >
      <Card padding={4}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="subheading" style={{ flex: 1 }}>
            {issueCategory(issue.category)}
          </Text>
          {issue.urgency === "URGENT" ? <Pill label="Urgent" tone="danger" /> : null}
          <Pill label={s.label} tone={s.tone} />
        </View>
        <Text variant="body" style={{ marginTop: space[2] }}>
          {issue.note}
        </Text>
        <Text variant="small" color="ink2" numeral style={{ marginTop: space[2] }}>
          {issue.reportedBy} · {shortDate(issue.reportedAt, timeZone)} {clockTime(issue.reportedAt, timeZone)}
        </Text>
      </Card>

      {photo ? (
        <Image source={{ uri: photo }} accessible accessibilityLabel="The photo sent with the report" style={{ width: "100%", aspectRatio: 4 / 3, borderRadius: radius.lg }} contentFit="cover" />
      ) : null}

      <Card
        padding={4}
        onPress={() => router.push({ pathname: "/manage/jobs/[id]", params: { id: issue.job.id } })}
        accessibilityLabel={`Open job ${issue.job.jobNumber}, ${issue.job.clientName}`}
      >
        <Text variant="bodyStrong">
          Job #{issue.job.jobNumber} · {issue.job.clientName}
        </Text>
        <Text variant="small" color="ink2" numeral>
          {shortDate(issue.job.startsAt, timeZone)} {clockTime(issue.job.startsAt, timeZone)}
        </Text>
      </Card>

      {resolved ? (
        <Notice tone="ok" icon="check" title={`Resolved${issue.resolvedBy ? ` by ${issue.resolvedBy}` : ""}`}>
          {issue.resolutionNote ?? "No note."}
        </Notice>
      ) : (
        <TextField
          label="What was done"
          value={note}
          onChangeText={(t) => {
            setNote(t);
            setError(null);
          }}
          multiline
          maxLength={MAX_ISSUE_NOTE}
          hint="Needed to resolve it. The cleaner sees this."
        />
      )}
    </Page>
  );
}
