import type { QuizSubmitResponse, TrainingModuleDetail } from "@bookmops/api/v1";
import { Button, Card, color, Icon, radius, space, Text } from "@bookmops/ui-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";

import { LoadError, Loading } from "@/components/QueryState";
import { useMe, useSetTrainingProgress, useSubmitQuiz, useTrainingModule } from "@/data/queries";
import { OptionList } from "@/features/record/OptionList";
import { BackHeader, confirm, errorText, FormError, Notice, Page, SectionTitle, Tag } from "@/features/record/ui";
import { moduleFacts, percent } from "@/features/training/display";
import { dayMonth } from "@/lib/dates";
import { useEventKey } from "@/lib/idempotency";
import { safeWebUrl } from "@/lib/urls";

/**
 * One training module: what it's about, its video, and its quiz. The video
 * plays in the phone's own player (YouTube, Vimeo or a file, as the office
 * linked it); the quiz opens once it's watched and is marked on the server.
 */
export default function TrainingModule() {
  const { moduleId } = useLocalSearchParams<{ moduleId: string }>();
  const me = useMe();
  const mod = useTrainingModule(moduleId);
  const tz = me.data?.company.timezone;

  if (mod.data && tz) return <Module detail={mod.data} timeZone={tz} refetch={() => mod.refetch()} refreshing={mod.isRefetching} />;
  return (
    <Page header={<BackHeader title="Training" />}>
      {mod.isError ? <LoadError error={mod.error} onRetry={() => mod.refetch()} /> : <Loading label="Loading the module" />}
    </Page>
  );
}

function Module({
  detail: m,
  timeZone,
  refetch,
  refreshing,
}: {
  detail: TrainingModuleDetail;
  timeZone: string;
  refetch: () => void;
  refreshing: boolean;
}) {
  const progress = useSetTrainingProgress(m.id);
  const submit = useSubmitQuiz(m.id);
  const progressKey = useEventKey();
  const quizKey = useEventKey();
  const [opened, setOpened] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizSubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const p = m.progress;
  const done = p.status === "COMPLETED";
  const watched = p.videoProgress >= m.watchedAt;
  const hasQuiz = m.questions.length > 0;
  const quizOpen = hasQuiz && watched && !done && !result?.passed;
  const answered = m.questions.filter((q) => answers[q.id] != null).length;
  const videoUrl = safeWebUrl(m.videoUrl);
  const needed = Math.ceil(m.passMark * m.questions.length);

  async function watch() {
    if (!videoUrl) return;
    try {
      await Linking.openURL(videoUrl);
      setOpened(true);
    } catch {
      setError("This video couldn't be opened on your phone. Ask the office for another link.");
    }
  }

  function markWatched() {
    if (progress.isPending) return;
    setError(null);
    const body = { videoProgress: Math.max(m.watchedAt, p.videoProgress), markComplete: !hasQuiz };
    progress.mutate(
      { ...body, clientEventId: progressKey.for(body) },
      {
        onSuccess: () => {
          progressKey.done();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        },
        onError: (e) => {
          progressKey.failed(e);
          setError(errorText(e));
        },
      },
    );
  }

  async function send() {
    if (answered < m.questions.length || submit.isPending) return;
    const ok = await confirm({
      title: "Submit your answers?",
      message: `You need ${needed} of ${m.questions.length} right to pass. This counts as try ${p.quizAttempts + 1}.`,
      confirmLabel: "Submit",
    });
    if (!ok) return;
    setError(null);
    const body = { answers: m.questions.map((q) => ({ questionId: q.id, selectedIndex: answers[q.id]! })) };
    submit.mutate(
      { ...body, clientEventId: quizKey.for(body) },
      {
        onSuccess: (res) => {
          quizKey.done();
          setResult(res);
          void Haptics.notificationAsync(
            res.passed ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
          ).catch(() => {});
        },
        onError: (e) => {
          quizKey.failed(e);
          setError(errorText(e));
        },
      },
    );
  }

  function retake() {
    setResult(null);
    setAnswers({});
    setError(null);
  }

  return (
    <Page
      header={<BackHeader title={m.title} subtitle={moduleFacts(m)} />}
      refreshing={refreshing}
      onRefresh={refetch}
      footer={
        quizOpen && !result ? (
          <>
            <FormError message={error} />
            <Button
              label={answered < m.questions.length ? `${answered} of ${m.questions.length} answered` : "Submit answers"}
              disabled={answered < m.questions.length}
              loading={submit.isPending}
              onPress={send}
            />
          </>
        ) : undefined
      }
    >
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        {m.isRequired ? <Tag label="Required" tone="warn" /> : null}
        {done ? <Tag label="Completed" tone="ok" /> : p.status === "FAILED" ? <Tag label="Quiz not passed" tone="critical" /> : null}
      </View>

      {done ? (
        <Notice tone="ok" icon="check" title="You've completed this module">
          {[
            p.completedAt ? `Done ${dayMonth(p.completedAt, timeZone)}` : null,
            p.quizScore != null ? `quiz ${percent(p.quizScore)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing more to do here."}
        </Notice>
      ) : null}

      {m.description ? (
        <Text variant="body" style={{ lineHeight: 23 }}>
          {m.description}
        </Text>
      ) : null}

      {m.hasVideo ? (
        <Card padding={4}>
          <View style={{ gap: space[3] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <Icon name="play" size={24} color="accentText" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">The video</Text>
                <Text variant="small" color={watched ? "success" : "ink2"}>
                  {watched ? "Watched" : opened ? "Opened. Come back when you've watched it." : "Opens in your phone's video player."}
                </Text>
              </View>
            </View>
            {videoUrl ? (
              <Button label={watched ? "Watch again" : "Watch the video"} variant={watched ? "secondary" : "primary"} icon="play" onPress={watch} />
            ) : (
              <Notice tone="neutral" icon="info">
                The video link can't be opened on a phone. Ask the office to check it.
              </Notice>
            )}
            {!watched ? (
              <Button
                label="I've watched it"
                variant="secondary"
                disabled={!opened}
                loading={progress.isPending}
                onPress={markWatched}
              />
            ) : null}
          </View>
        </Card>
      ) : !done && !watched ? (
        <Button label="I've read it" variant="secondary" loading={progress.isPending} onPress={markWatched} />
      ) : null}

      {!quizOpen || result ? <FormError message={error} /> : null}

      {hasQuiz && !done ? (
        <>
          <SectionTitle>{`Quiz · ${m.questions.length} question${m.questions.length === 1 ? "" : "s"}`}</SectionTitle>
          {!watched && !result ? (
            <Notice tone="neutral" icon="lock">
              {m.hasVideo ? "Watch the video first. The questions open once you've marked it watched." : "Mark it read first, then answer the questions."}
            </Notice>
          ) : result ? (
            <Result result={result} needed={needed} watched={watched} onRetake={retake} />
          ) : (
            m.questions.map((q, i) => (
              <View key={q.id} style={{ gap: space[2] }}>
                <Text variant="bodyStrong" accessibilityRole="header">
                  {i + 1}. {q.question}
                </Text>
                <OptionList
                  label={q.question}
                  options={q.options.map((o, n) => ({ value: String(n), label: o.text }))}
                  value={answers[q.id] != null ? String(answers[q.id]) : null}
                  onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: Number(v) }))}
                />
              </View>
            ))
          )}
        </>
      ) : null}
    </Page>
  );
}

function Result({ result, needed, watched, onRetake }: { result: QuizSubmitResponse; needed: number; watched: boolean; onRetake: () => void }) {
  if (result.passed) {
    return (
      <Notice tone="ok" icon="check" title={`Passed · ${result.correct} of ${result.total}`}>
        {watched ? "Module complete. Nice work." : "Mark the video watched to complete the module."}
      </Notice>
    );
  }
  return (
    <View style={{ gap: space[3] }}>
      <Notice tone="critical" icon="warning" title={`Not passed · ${result.correct} of ${result.total}`}>
        {`You need ${needed} to pass. Go over the video again, then have another go.`}
      </Notice>
      <Button label="Retake the quiz" onPress={onRetake} />
    </View>
  );
}
