import { DELETION_REASON_MAX } from "@bookmops/api/v1";
import { Button, color, Icon, radius, space, Text, TextField, type IconName } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { View } from "react-native";

import { goBackOr } from "@/components/BackButton";
import { LoadError, Loading } from "@/components/QueryState";
import { useDeletionRequest, useMe, useRequestDeletion } from "@/data/queries";
import { BackHeader, confirm, errorText, FormError, Notice, Page } from "@/features/record/ui";
import { useEventKey } from "@/lib/idempotency";
import { longDate } from "@/lib/format";

/**
 * "Delete my account" (App Store guideline 5.1.1(v)). The account was made by
 * the person's employer, and the company must keep pay and tax records, so
 * this asks the company to delete it rather than deleting anything itself.
 * The server records the request and tells the office; asking twice is one
 * request.
 */
export default function DeleteAccount() {
  const me = useMe();
  const state = useDeletionRequest();
  const request = useRequestDeletion();
  const key = useEventKey();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const company = me.data?.company;
  const companyName = company?.name ?? "your company";
  const pending = state.data?.pending ?? false;

  async function submit() {
    if (request.isPending) return;
    setError(null);
    const ok = await confirm({
      title: `Send this request to ${companyName}?`,
      message: "They'll delete your account and let you know. You can keep using the app until they do.",
      confirmLabel: "Send request",
      destructive: true,
    });
    if (!ok) return;
    const body = { reason: reason.trim() || undefined };
    request.mutate(
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

  const header = <BackHeader title="Delete my account" />;

  if (state.isPending || me.isPending) {
    return (
      <Page header={header}>
        <Loading label="Loading" />
      </Page>
    );
  }
  if (state.isError || me.isError) {
    return (
      <Page header={header}>
        <LoadError
          error={state.error ?? me.error}
          onRetry={() => {
            void state.refetch();
            void me.refetch();
          }}
        />
      </Page>
    );
  }

  if (pending) {
    const at = state.data?.requestedAt;
    return (
      <Page header={header} footer={<Button label="Done" variant="secondary" onPress={() => goBackOr("/more")} />}>
        <Notice tone="ok" icon="check" title="Request sent">
          {`${companyName} has your request${at && company ? ` from ${longDate(at, company.timezone)}` : ""}. They'll delete your account and let you know. Until then it stays as it is, and you can keep using the app.`}
        </Notice>
        <Text variant="body" color="ink2">
          Changed your mind, or haven't heard back? Message the office from Office chat, or contact {companyName} directly.
        </Text>
      </Page>
    );
  }

  return (
    <Page
      header={header}
      footer={<Button label="Request account deletion" variant="danger" loading={request.isPending} onPress={submit} />}
    >
      <Text variant="body" color="ink2">
        Your account was set up by {companyName}, your employer, so they delete it, not the app. Send them a request here
        and they'll take it from there.
      </Text>

      <Fact
        icon="trash"
        title="What gets deleted"
        lines={["Your sign-in and profile", "Your contact details and availability", "Your notification settings on this phone"]}
      />
      <Fact
        icon="document"
        title="What the company keeps"
        lines={[
          "Pay, hours and tax records, which the law requires them to keep",
          "Records of jobs you worked, for their clients and their books",
        ]}
      />

      <TextField
        label="Anything you'd like them to know? (optional)"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. I've left the company"
        maxLength={DELETION_REASON_MAX}
        multiline
      />
      <FormError message={error} />
    </Page>
  );
}

function Fact({ icon, title, lines }: { icon: IconName; title: string; lines: readonly string[] }) {
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${lines.join(". ")}.`}
      style={{ flexDirection: "row", gap: space[3], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface }}
    >
      <Icon name={icon} size={20} color="accentText" />
      <View style={{ flex: 1, gap: space[1] }}>
        <Text variant="bodyStrong">{title}</Text>
        {lines.map((line) => (
          <Text key={line} variant="small" color="ink2">
            {`• ${line}`}
          </Text>
        ))}
      </View>
    </View>
  );
}
