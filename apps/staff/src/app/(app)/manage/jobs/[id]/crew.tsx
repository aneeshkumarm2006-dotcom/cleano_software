import { ApiError } from "@bookmops/api/client";
import type { Candidate, ManagerJobResponse } from "@bookmops/api/v1";
import { Button, Card, Checkbox, Pill, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { goBackOr } from "@/components/BackButton";
import { Guarded } from "@/components/Guarded";
import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useAddCleaner, useCrewCandidates, useManagerJob, useMe, useSetCrew } from "@/data/queries";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle } from "@/features/record/ui";
import { clockTime, shortDate } from "@/lib/format";
import { useEventKey } from "@/lib/idempotency";

const AVAILABILITY: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  AVAILABLE: { label: "Available", tone: "success" },
  OUTSIDE_HOURS: { label: "Outside hours", tone: "warning" },
  UNAVAILABLE: { label: "Unavailable", tone: "danger" },
  NO_DATA: { label: "No availability", tone: "neutral" },
};

/**
 * Who works a job. OWNER and ADMIN set the whole crew (assign, unassign,
 * reassign), as the web's Team card; an ops manager adds one cleaner at a
 * time, as the web's bulk assign, and can't remove anyone. The web's
 * warnings (outside their hours, a day off, a service they aren't approved
 * for) are shown on each person and again before saving; they warn, they
 * don't block, exactly as on the web. A crew of trainees alone is refused.
 */
export default function CrewScreen() {
  return (
    <Guarded need={["CREW_SET", "CREW_ADD"]}>
      <Crew />
    </Guarded>
  );
}

function Crew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const job = useManagerJob(id);
  const candidates = useCrewCandidates(id);
  const tz = me.data?.company.timezone;
  const back = `/manage/jobs/${id}` as const;

  const header = (
    <BackHeader
      title={job.data?.can.setCrew ? "Crew" : "Add a cleaner"}
      subtitle={job.data && tz ? `#${job.data.jobNumber} · ${shortDate(job.data.startsAt, tz)} ${clockTime(job.data.startsAt, tz)}` : undefined}
      fallback={back}
      backLabel="Back to the job"
    />
  );

  if (job.isPending || candidates.isPending || !tz) {
    return (
      <Page header={header}>
        <Loading label="Loading who could work it" />
      </Page>
    );
  }
  if (job.isError || candidates.isError) {
    return (
      <Page header={header}>
        <LoadError
          error={job.error ?? candidates.error}
          onRetry={() => {
            void job.refetch();
            void candidates.refetch();
          }}
        />
      </Page>
    );
  }

  const reload = () => {
    void job.refetch();
    void candidates.refetch();
  };
  return job.data.can.setCrew ? (
    <SetCrew key={job.data.crew.map((c) => c.id).join()} header={header} job={job.data} candidates={candidates.data.candidates} onStale={reload} />
  ) : job.data.can.addCleaner ? (
    <AddOne header={header} job={job.data} candidates={candidates.data.candidates} onStale={reload} />
  ) : (
    <Page header={header}>
      <Notice tone="neutral" icon="info">
        This job's crew can't be changed from here.
      </Notice>
    </Page>
  );
}

function CandidateText({ c }: { c: Candidate }) {
  const a = AVAILABILITY[c.availability] ?? AVAILABILITY.NO_DATA!;
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
        <Text variant="bodyStrong">{c.name}</Text>
        {c.tier === "TRAINEE" ? <Pill label="Trainee" tone="neutral" /> : c.tier === "FIELD_LEAD" ? <Pill label="Field lead" tone="accent" /> : null}
        <Pill label={c.dayOff ? "Day off" : a.label} tone={c.dayOff ? "danger" : a.tone} />
      </View>
      {c.warnings.map((w) => (
        <Text key={w} variant="small" color="warning">
          {w}
        </Text>
      ))}
    </View>
  );
}

const spoken = (c: Candidate) =>
  [c.name, c.tier === "TRAINEE" ? "trainee" : null, c.dayOff ? "day off" : (AVAILABILITY[c.availability]?.label ?? null), ...c.warnings]
    .filter(Boolean)
    .join(", ");

/** What a refusal means here: a crew changed underneath is reloaded, not just reported. */
function useRefusal(onStale: () => void) {
  const [error, setError] = useState<string | null>(null);
  return {
    error,
    clear: () => setError(null),
    fail: (e: unknown) => {
      setError(errorText(e));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (e instanceof ApiError && e.code === "CREW_CHANGED") onStale();
    },
  };
}

function SetCrew({
  header,
  job,
  candidates,
  onStale,
}: {
  header: ReactNode;
  job: ManagerJobResponse;
  candidates: readonly Candidate[];
  onStale: () => void;
}) {
  const current = job.crew.map((c) => c.id);
  const [picked, setPicked] = useState<readonly string[]>(current);
  const setCrew = useSetCrew(job.id);
  const key = useEventKey();
  const refusal = useRefusal(onStale);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const added = picked.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !picked.includes(id));
  const dirty = added.length + removed.length > 0;
  const name = (id: string) => byId.get(id)?.name ?? job.crew.find((c) => c.id === id)?.name ?? "Someone";
  const warnings = added.flatMap((id) => byId.get(id)?.warnings ?? []);
  const traineesOnly = picked.length > 0 && picked.every((id) => byId.get(id)?.tier === "TRAINEE");

  function toggle(id: string, on: boolean) {
    refusal.clear();
    setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  }

  async function save() {
    if (!dirty || setCrew.isPending) return;
    const lines = [
      added.length ? `Adding: ${added.map(name).join(", ")}` : null,
      removed.length ? `Taking off: ${removed.map(name).join(", ")}` : null,
      picked.length === 0 ? "The job will have nobody on it." : null,
      warnings.length ? `\nHeads up:\n${warnings.map((w) => `• ${w}`).join("\n")}` : null,
      added.length ? "\nThe new cleaners are sent an invite, and the client is told, as from the web." : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: removed.length && !added.length ? "Take them off this job?" : "Save this crew?",
      message: lines.join("\n"),
      confirmLabel: warnings.length ? "Save anyway" : "Save",
      destructive: removed.length > 0 && added.length === 0,
    });
    if (!ok) return;
    const body = { cleanerIds: [...picked], expectedCrewIds: current, acknowledgedWarnings: warnings.length > 0 };
    setCrew.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBackOr(`/manage/jobs/${job.id}`);
        },
        onError: (e) => {
          key.failed(e);
          refusal.fail(e);
        },
      },
    );
  }

  return (
    <Page
      header={header}
      footer={
        <>
          <FormError message={traineesOnly ? "A trainee must work with a field lead or an approved cleaner. Add one." : refusal.error} />
          <Button
            label={dirty ? `Save crew · ${picked.length} of ${job.staffing.required}` : "No changes"}
            onPress={save}
            loading={setCrew.isPending}
            disabled={!dirty || traineesOnly}
          />
        </>
      }
    >
      <Text variant="body" color="ink2">
        This job needs {job.staffing.required} {job.staffing.required === 1 ? "cleaner" : "cleaners"}. Tick who works it.
      </Text>
      <Card padding={4}>
        <View style={{ gap: space[2] }}>
          {candidates.map((c) => (
            <Checkbox key={c.id} checked={picked.includes(c.id)} onChange={(on) => toggle(c.id, on)} accessibilityLabel={spoken(c)}>
              <CandidateText c={c} />
            </Checkbox>
          ))}
        </View>
      </Card>
    </Page>
  );
}

function AddOne({
  header,
  job,
  candidates,
  onStale,
}: {
  header: ReactNode;
  job: ManagerJobResponse;
  candidates: readonly Candidate[];
  onStale: () => void;
}) {
  const add = useAddCleaner(job.id);
  const key = useEventKey();
  const refusal = useRefusal(onStale);
  const [adding, setAdding] = useState<string | null>(null);
  const open = candidates.filter((c) => !c.onJob);

  async function pick(c: Candidate) {
    if (add.isPending) return;
    refusal.clear();
    const ok = await confirm({
      title: `Add ${c.name} to this job?`,
      message: c.warnings.length ? `Heads up:\n${c.warnings.map((w) => `• ${w}`).join("\n")}` : undefined,
      confirmLabel: c.warnings.length ? "Add anyway" : "Add",
    });
    if (!ok) return;
    const body = { cleanerId: c.id, acknowledgedWarnings: c.warnings.length > 0 };
    setAdding(c.id);
    add.mutate(
      { ...body, clientEventId: key.for(body) },
      {
        onSuccess: () => {
          key.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          goBackOr(`/manage/jobs/${job.id}`);
        },
        onError: (e) => {
          key.failed(e);
          refusal.fail(e);
        },
        onSettled: () => setAdding(null),
      },
    );
  }

  return (
    <Page header={header}>
      <Notice tone="neutral" icon="info">
        You can add a cleaner. Taking someone off a job, and adding a trainee, is done by an admin.
      </Notice>
      <FormError message={refusal.error} />
      {open.length === 0 ? (
        <Empty icon="team" title="Everyone is already on it" />
      ) : (
        <>
          <SectionTitle>Who could work it</SectionTitle>
          {open.map((c) => {
            const trainee = c.tier === "TRAINEE";
            return (
              <Card
                key={c.id}
                padding={4}
                onPress={trainee ? undefined : () => void pick(c)}
                accessible
                accessibilityLabel={trainee ? `${spoken(c)}. Added by an admin with the rest of the crew.` : `Add ${spoken(c)}`}
                accessibilityState={{ disabled: trainee, busy: adding === c.id }}
              >
                <CandidateText c={c} />
                {trainee ? (
                  <Text variant="small" color="ink3" style={{ marginTop: space[1] }}>
                    Trainees are added by an admin, with the rest of the crew.
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </Page>
  );
}
