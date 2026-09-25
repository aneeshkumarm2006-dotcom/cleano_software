import type { JobIssue, JobIssueCategory, JobIssueUrgency, ReportIssueRequest } from "@bookmops/api/v1";
import { JOB_ISSUE_CATEGORIES, MAX_ISSUE_NOTE } from "@bookmops/api/v1";
import { JOB_ISSUE_CATEGORY_HINT, JOB_ISSUE_CATEGORY_LABEL } from "@bookmops/core/jobs";
import { Button, Card, ChoiceChips, color, Icon, radius, space, Text, TextField } from "@bookmops/ui-native";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BackButton, goBackOr } from "@/components/BackButton";
import { LoadError, Loading } from "@/components/QueryState";
import { useJob, useJobIssues, useMe, useReportIssue } from "@/data/queries";
import { useSource } from "@/data/session";
import { IssueList } from "@/features/issues/IssueList";
import { useIssuePhoto } from "@/features/issues/useIssuePhoto";

const CATEGORY_OPTIONS = JOB_ISSUE_CATEGORIES.map((value) => ({ value, label: JOB_ISSUE_CATEGORY_LABEL[value], tone: "warn" as const }));

const URGENCY_OPTIONS = [
  { value: "NORMAL", label: "Can wait", tone: "ok" },
  { value: "URGENT", label: "I'm blocked right now", tone: "bad" },
] as const;

/** Show the character count only near the cap, so it doesn't nag from the first letter. */
const COUNT_FROM = Math.floor(MAX_ISSUE_NOTE * 0.8);

/**
 * Tell the office something is wrong: locked out, supplies missing, damage, a
 * job far bigger than booked. Open before, during and after the shift. The
 * report reaches the office with the job attached; urgent ones are emailed at
 * once.
 */
export default function ReportIssue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const job = useJob(id);
  const [sent, setSent] = useState<JobIssue | null>(null);
  // A fresh form for "report something else", with nothing carried over.
  const [formKey, setFormKey] = useState(0);

  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <BackButton fallback="/" />
        <Text variant="eyebrow" color="ink3" style={{ flex: 1 }} numberOfLines={1}>
          {job.data?.address.line1 ?? ""}
        </Text>
      </View>

      {sent ? (
        <Sent
          issue={sent}
          jobId={id}
          bottom={insets.bottom}
          onAnother={() => {
            setSent(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : (
        <IssueForm key={formKey} jobId={id} bottom={insets.bottom} onSent={setSent} />
      )}
    </View>
  );
}

function IssueForm({ jobId, bottom, onSent }: { jobId: string; bottom: number; onSent: (issue: JobIssue) => void }) {
  const source = useSource();
  const report = useReportIssue(jobId);
  const photo = useIssuePhoto(jobId, source);
  const [category, setCategory] = useState<JobIssueCategory | null>(null);
  const [urgency, setUrgency] = useState<JobIssueUrgency>("NORMAL");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One report, one id: a retry of the same report reuses it, so the server
  // files it once. Change the report and it becomes a new one.
  const attempt = useRef<{ id: string; body: string } | null>(null);

  const trimmed = note.trim();
  const ready = category !== null && trimmed.length > 0 && photo.photo?.status !== "preparing";
  const missing = category === null ? "Pick what it's about." : trimmed.length === 0 ? "Say what happened." : null;

  async function send() {
    if (!ready || sending || !category) return;
    setSending(true);
    setError(null);
    try {
      const photoKey = await photo.upload();
      const fields = { category, urgency, note: trimmed, photoKey };
      const fingerprint = JSON.stringify(fields);
      if (!attempt.current || attempt.current.body !== fingerprint) attempt.current = { id: randomUUID(), body: fingerprint };
      const body: ReportIssueRequest = { ...fields, clientEventId: attempt.current.id };
      const issue = await report.mutateAsync(body);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSent(issue);
    } catch (e) {
      setError(e instanceof Error ? e.message : "It didn't send. Check your signal and try again.");
    } finally {
      setSending(false);
    }
  }

  const sendingPhoto = photo.photo?.status === "sending";

  return (
    <>
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[5], paddingBottom: 130 + bottom }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        <View style={{ gap: space[1] }}>
          <Text variant="title" accessibilityRole="header">
            Report an issue
          </Text>
          <Text variant="body" color="ink2">
            It goes to the office with this job attached.
          </Text>
        </View>

        <Field title="What's it about?">
          <ChoiceChips label="What the problem is about" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
          {category ? (
            <Text variant="small" color="ink2">
              {JOB_ISSUE_CATEGORY_HINT[category]}
            </Text>
          ) : null}
        </Field>

        <Field title="How urgent is it?">
          <ChoiceChips label="How urgent it is" options={URGENCY_OPTIONS} value={urgency} onChange={setUrgency} />
          {urgency === "URGENT" ? (
            <View style={{ padding: space[3], borderRadius: radius.md, backgroundColor: color.warningSoft }}>
              <Text variant="small" color="warning">
                The office is emailed straight away. Use this when you can't carry on until someone answers.
              </Text>
            </View>
          ) : null}
        </Field>

        <TextField
          label="What happened?"
          value={note}
          onChangeText={setNote}
          placeholder="Where you are, what you tried, what you need."
          multiline
          numberOfLines={4}
          maxLength={MAX_ISSUE_NOTE}
          textAlignVertical="top"
          autoCapitalize="sentences"
          hint={note.length >= COUNT_FROM ? `${MAX_ISSUE_NOTE - note.length} characters left` : undefined}
        />

        <Field title="Photo (optional)">
          {photo.photo ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Image
                source={{ uri: photo.photo.uri }}
                style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: color.groundDeep }}
                contentFit="cover"
                accessible
                accessibilityLabel="The photo going with this report"
              />
              <View style={{ flex: 1, gap: space[1] }}>
                <Text variant="small" color="ink2" numeral>
                  {photo.photo.status === "preparing"
                    ? "Getting it ready…"
                    : sendingPhoto
                      ? `Sending ${Math.round(photo.photo.progress * 100)}%`
                      : photo.photo.status === "sent"
                        ? "Sent"
                        : "Goes with the report"}
                </Text>
                <Button label="Remove photo" variant="secondary" size="md" disabled={sending} onPress={photo.clear} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <Button label="Take photo" icon="camera" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => photo.pick("camera")} />
              <Button label="Library" icon="library" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => photo.pick("library")} />
            </View>
          )}
          {photo.error ? (
            <Text variant="small" color="danger">
              {photo.error}
            </Text>
          ) : null}
        </Field>

        <MyReports jobId={jobId} />
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space[4],
          paddingTop: space[3],
          paddingBottom: bottom + space[3],
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.line,
          gap: space[2],
        }}
      >
        {error ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
            <Icon name="warning" size={18} color="danger" />
            <Text variant="small" color="danger" style={{ flex: 1 }}>
              {error}
            </Text>
          </View>
        ) : missing ? (
          <Text variant="small" color="ink2" align="center">
            {missing}
          </Text>
        ) : null}
        <Button label={error ? "Send again" : "Send to the office"} loading={sending} disabled={!ready} onPress={send} />
      </View>
    </>
  );
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <Text variant="small" weight="semibold" color="ink2">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Sent({ issue, jobId, bottom, onAnother }: { issue: JobIssue; jobId: string; bottom: number; onAnother: () => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[5], paddingBottom: space[6] + bottom }} showsVerticalScrollIndicator={false}>
      <Card padding={5} style={{ backgroundColor: color.successSoft, borderColor: color.successSoft }}>
        <View accessibilityLiveRegion="polite" style={{ alignItems: "center", gap: space[3] }}>
          <Icon name="check" size={44} color="success" />
          <Text variant="heading" align="center" accessibilityRole="header">
            Sent to the office
          </Text>
          <Text variant="body" color="ink2" align="center">
            {issue.urgency === "URGENT"
              ? "They've been emailed straight away. Keep your phone close so they can reach you."
              : "They'll see it with this job attached. You'll see their answer here."}
          </Text>
        </View>
      </Card>
      <View style={{ gap: space[2] }}>
        <Button label="Back to the job" onPress={() => goBackOr({ pathname: "/jobs/[id]", params: { id: jobId } })} />
        <Button label="Report something else" variant="secondary" onPress={onAnother} />
      </View>
      <MyReports jobId={jobId} />
    </ScrollView>
  );
}

/** What this cleaner has already reported on this job. Nothing shows when there's nothing. */
function MyReports({ jobId }: { jobId: string }) {
  const me = useMe();
  const issues = useJobIssues(jobId);
  const tz = me.data?.company.timezone;
  const items = issues.data?.pages.flatMap((p) => p.items) ?? [];

  if (issues.isPending || !tz) return <Loading label="Loading your reports" />;
  if (issues.isError) return <LoadError error={issues.error} onRetry={() => issues.refetch()} />;
  if (items.length === 0) return null;

  return (
    <View style={{ gap: space[3] }}>
      <Text variant="eyebrow" color="chrome" accessibilityRole="header">
        Your reports on this job
      </Text>
      <IssueList issues={items} timeZone={tz} />
      {issues.hasNextPage ? (
        <Button label="Show earlier reports" variant="secondary" size="md" loading={issues.isFetchingNextPage} onPress={() => issues.fetchNextPage()} />
      ) : null}
    </View>
  );
}
