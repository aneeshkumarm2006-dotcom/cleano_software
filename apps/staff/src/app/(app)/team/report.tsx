import { MESSAGE_REPORT_REASONS, type MessageReportReason, REPORT_NOTE_MAX } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";
import { Button, ChoiceChips, Text, TextField } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { goBackOr } from "@/components/BackButton";
import { useReportMessage, useSetBlocked, useTeamBlocks } from "@/data/queries";
import { BackHeader, errorText, FormError, Notice, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";

const REASON_LABEL: Record<MessageReportReason, string> = {
  HARASSMENT: "Harassment",
  INAPPROPRIATE: "Inappropriate",
  SPAM: "Spam",
  OTHER: "Other",
};

const OPTIONS = MESSAGE_REPORT_REASONS.map((value) => ({ value, label: REASON_LABEL[value], tone: "bad" as const }));

/**
 * Report someone else's team chat message to the office (App Store guideline
 * 1.2): a reason, an optional note, and then the option to block the sender
 * too. The office decides what happens to the message; reporting it twice is
 * one report.
 */
export default function ReportMessage() {
  const params = useLocalSearchParams<{ messageId: string; senderId?: string; name?: string }>();
  const name = params.name || "this person";
  const report = useReportMessage(params.messageId);
  const blocks = useTeamBlocks();
  const setBlocked = useSetBlocked();
  const key = useEventKey();
  const [reason, setReason] = useState<MessageReportReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alreadyBlocked = !!params.senderId && !!blocks.data?.items.some((b) => b.id === params.senderId);

  function submit() {
    if (report.isPending) return;
    if (!reason) return setError("Choose what's wrong with it.");
    setError(null);
    const body = { reason, note: note.trim() || undefined };
    report.mutate(
      { ...body, clientEventId: key.for(body) },
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

  function block() {
    const senderId = params.senderId;
    if (!senderId || setBlocked.isPending) return;
    setBlocked.mutate(
      { userId: senderId, blocked: true },
      {
        onError: (e) => Alert.alert(`Couldn't block ${name}`, e instanceof ApiError ? e.message : "Check your connection and try again."),
      },
    );
  }

  const header = <BackHeader title="Report message" subtitle={params.name ? `From ${params.name}` : undefined} fallback="/team" />;

  if (report.isSuccess) {
    const blocked = alreadyBlocked || setBlocked.isSuccess;
    return (
      <Page
        header={header}
        footer={
          <>
            {params.senderId && !blocked ? (
              <Button label={`Block ${name}`} variant="secondary" icon="eyeOff" loading={setBlocked.isPending} onPress={block} />
            ) : null}
            <Button label="Done" onPress={() => goBackOr("/team")} />
          </>
        }
      >
        <Notice tone="ok" icon="check" title="Report sent">
          The office has your report and will look at the message. {name} isn't told who reported it.
        </Notice>
        {blocked ? (
          <Notice tone="neutral" icon="eyeOff">
            {`You've blocked ${name}. Their messages are hidden from you, and neither of you can send the other a direct message.`}
          </Notice>
        ) : (
          <Text variant="body" color="ink2">
            {`Don't want to see ${name}'s messages? Block them: they won't be told, and you can unblock them any time.`}
          </Text>
        )}
      </Page>
    );
  }

  return (
    <Page header={header} footer={<Button label="Send report" variant="danger" loading={report.isPending} onPress={submit} />}>
      <Text variant="body" color="ink2">
        Tell the office what's wrong with this message. They'll look at it and decide what to do.
      </Text>
      <View style={{ gap: 8 }}>
        <Text variant="bodyStrong">What's wrong with it?</Text>
        <ChoiceChips label="What's wrong with it?" options={OPTIONS} value={reason} onChange={setReason} />
      </View>
      <TextField
        label="Anything else? (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="What happened"
        maxLength={REPORT_NOTE_MAX}
        multiline
      />
      <FormError message={error} />
    </Page>
  );
}
