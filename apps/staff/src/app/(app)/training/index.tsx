import type { TrainingModuleSummary } from "@bookmops/api/v1";
import { Button, Card, color, Icon, ProgressRing, radius, space, Text } from "@bookmops/ui-native";
import { router } from "expo-router";
import { Fragment } from "react";
import { Pressable, View } from "react-native";

import { Empty, LoadError, Loading } from "@/components/QueryState";
import { useMe, useTraining } from "@/data/queries";
import { BackHeader, Page, SectionTitle, Tag } from "@/features/record/ui";
import { isDone, moduleFacts, percent } from "@/features/training/display";
import { dayMonth } from "@/lib/dates";

const open = (m: TrainingModuleSummary) => router.push({ pathname: "/training/[moduleId]", params: { moduleId: m.id } });

/** Training: how far through the cleaner is, what's left, and what's done. */
export default function Training() {
  const me = useMe();
  const training = useTraining();
  const tz = me.data?.company.timezone;
  const items = training.data?.items ?? [];
  // Required modules first among what's left, then the office's order.
  const todo = items.filter((m) => !isDone(m)).sort((a, b) => Number(b.isRequired) - Number(a.isRequired));
  const done = items.filter(isDone);

  return (
    <Page header={<BackHeader title="Training" />} refreshing={training.isRefetching} onRefresh={() => training.refetch()}>
      {training.isPending || !tz ? (
        <Loading label="Loading training" />
      ) : training.isError ? (
        <LoadError error={training.error} onRetry={() => training.refetch()} />
      ) : items.length === 0 ? (
        <Empty icon="training" title="No training yet" detail="Modules the office adds for you show up here." />
      ) : (
        <>
          <Summary completed={training.data.completed} total={training.data.total} requiredLeft={todo.filter((m) => m.isRequired).length} />

          {todo.length > 0 ? (
            <>
              <SectionTitle>To do</SectionTitle>
              {todo.map((m, i) => (
                <ToDoCard key={m.id} module={m} next={i === 0} />
              ))}
            </>
          ) : null}

          {done.length > 0 ? (
            <>
              <SectionTitle>Completed</SectionTitle>
              <View style={{ backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, overflow: "hidden" }}>
                {done.map((m, i) => (
                  <Fragment key={m.id}>
                    {i > 0 ? <View style={{ height: 1, backgroundColor: color.line, marginLeft: 52 }} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${m.title}, ${completedLine(m, tz)}`}
                      onPress={() => open(m)}
                      style={({ pressed }) => ({
                        minHeight: 60,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space[3],
                        paddingHorizontal: space[4],
                        backgroundColor: pressed ? color.groundDeep : color.surface,
                      })}
                    >
                      <Icon name="check" size={22} color="success" />
                      <View style={{ flex: 1, gap: 2, paddingVertical: space[3] }}>
                        <Text variant="bodyStrong">{m.title}</Text>
                        <Text variant="small" color="ink2" numeral>
                          {completedLine(m, tz)}
                        </Text>
                      </View>
                      <Icon name="forward" size={16} color="ink3" />
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}

function completedLine(m: TrainingModuleSummary, tz: string): string {
  const when = m.progress.completedAt ? dayMonth(m.progress.completedAt, tz) : null;
  if (m.progress.quizScore != null) return [when ? `Passed ${when}` : "Passed", percent(m.progress.quizScore)].join(" · ");
  return when ? `Done ${when}` : "Done";
}

function Summary({ completed, total, requiredLeft }: { completed: number; total: number; requiredLeft: number }) {
  const left = total - completed;
  return (
    <Card tone="active" padding={5}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[5] }}>
        <ProgressRing
          progress={total ? completed / total : 0}
          size={88}
          strokeWidth={9}
          color={color.successOnChrome}
          trackColor="rgba(255,255,255,0.13)"
          accessibilityLabel={`${completed} of ${total} modules done`}
        >
          <Text variant="heading" color="onChrome" numeral style={{ lineHeight: 22 }}>
            {completed}
          </Text>
          <Text variant="small" weight="bold" color="onChrome3" numeral style={{ fontSize: 11, lineHeight: 13 }}>
            of {total}
          </Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: space[1] }}>
          <Text variant="eyebrow" color="onChrome3" style={{ fontSize: 10 }}>
            Your progress
          </Text>
          <Text variant="subheading" color="onChrome">
            {left === 0 ? "All done" : left === 1 ? "One module left" : `${left} modules left`}
          </Text>
          <Text variant="small" color="onChrome2">
            {left === 0
              ? "You're up to date. New modules show up here."
              : requiredLeft > 0
                ? `${requiredLeft} of them ${requiredLeft === 1 ? "is" : "are"} required.`
                : "None of them are required, but they help."}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function ToDoCard({ module: m, next }: { module: TrainingModuleSummary; next: boolean }) {
  const status = m.progress.status;
  const action = status === "FAILED" ? "Retake the quiz" : status === "IN_PROGRESS" ? "Continue" : "Start module";
  return (
    <Card padding={4} style={next ? { borderColor: color.lineStrong, borderWidth: 1.5 } : undefined}>
      <View style={{ gap: space[3] }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
          <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
            <Icon name={m.hasVideo ? "play" : "training"} size={22} color="accentText" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheading">{m.title}</Text>
            <Text variant="small" color="ink2" numeral>
              {moduleFacts(m)}
            </Text>
          </View>
          {m.isRequired ? <Tag label="Required" tone="warn" /> : null}
        </View>
        {status === "FAILED" && m.progress.quizScore != null ? (
          <Text variant="small" color="danger" numeral>
            Last try {percent(m.progress.quizScore)}. Have another go.
          </Text>
        ) : null}
        <Button label={action} variant={next ? "primary" : "secondary"} size={next ? "lg" : "md"} onPress={() => open(m)} />
      </View>
    </Card>
  );
}
