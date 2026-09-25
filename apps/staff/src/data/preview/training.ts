// Sample training for development builds: six modules done and one to go,
// with a quiz that is marked here the way the server marks it — the answers
// never leave this file.
import type { TrainingModuleDetail, TrainingModuleSummary, TrainingProgress } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { once } from "./replay";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const done = (days: number, score: number | null): TrainingProgress => ({
  status: "COMPLETED",
  videoProgress: 1,
  quizScore: score,
  quizAttempts: score == null ? 0 : 1,
  completedAt: daysAgo(days),
});
const fresh = (): TrainingProgress => ({ status: "NOT_STARTED", videoProgress: 0, quizScore: null, quizAttempts: 0, completedAt: null });

interface Module extends Omit<TrainingModuleDetail, "progress" | "questionCount" | "passMark" | "watchedAt"> {
  answers: number[];
}

const QUESTIONS = [
  { id: "q1", question: "Where do bottles travel in the van?", options: ["Loose in the footwell", "In the labelled caddy", "In the customer's bag"], answer: 1 },
  { id: "q2", question: "Which two products are never stored side by side?", options: ["Glass cleaner and spray", "Descaler and oven cleaner", "Gloves and cloths"], answer: 1 },
  { id: "q3", question: "Before using a product in a bathroom, you…", options: ["Open a window", "Close the door", "Turn on the shower"], answer: 0 },
  { id: "q4", question: "Can you mix two of our own products in one bucket?", options: ["Yes, if both are ours", "Only with water first", "Never"], answer: 2 },
  { id: "q5", question: "The caddy dividers are damaged. What do you do?", options: ["Carry on", "Report it in the app and get a new one", "Tape them"], answer: 1 },
];

const MODULES: Module[] = [
  {
    id: "m-chem",
    title: "Chemical safety refresher",
    description:
      "How we store, carry and use cleaning products, and what to do if something spills or splashes. Watch the video, then answer five short questions.",
    hasVideo: true,
    videoUrl: "https://example.com/training/chemical-safety.mp4",
    durationSeconds: 720,
    isRequired: true,
    questions: QUESTIONS.map(({ id, question, options }) => ({ id, question, options: options.map((text) => ({ text })) })),
    answers: QUESTIONS.map((q) => q.answer),
  },
  ...(
    [
      ["m-deep", "Deep clean standard", 21, 1],
      ["m-occupied", "Working in occupied homes", 35, 0.9],
      ["m-pets", "Pets and allergies", 42, 0.95],
      ["m-app", "Using the app on a job", 54, null],
      ["m-keys", "Keys, codes and alarms", 60, 1],
      ["m-welcome", "Welcome to the team", 70, null],
    ] as const
  ).map(([id, title]) => ({
    id,
    title,
    description: null,
    hasVideo: true,
    videoUrl: "https://example.com/training/module.mp4",
    durationSeconds: 480,
    isRequired: id !== "m-welcome",
    questions: [],
    answers: [],
  })),
];

const progress = new Map<string, TrainingProgress>([
  ["m-chem", fresh()],
  ["m-deep", done(21, 1)],
  ["m-occupied", done(35, 0.9)],
  ["m-pets", done(42, 0.95)],
  ["m-app", done(54, null)],
  ["m-keys", done(60, 1)],
  ["m-welcome", done(70, null)],
]);
// The completed modules above were passed with a quiz where they have a score.
for (const [id, p] of progress) {
  const m = MODULES.find((x) => x.id === id)!;
  if (p.quizScore != null && m.questions.length === 0) {
    m.questions = QUESTIONS.slice(0, 3).map(({ id: qid, question, options }) => ({ id: `${m.id}-${qid}`, question, options: options.map((text) => ({ text })) }));
    m.answers = QUESTIONS.slice(0, 3).map((q) => q.answer);
  }
}

function summary(m: Module): TrainingModuleSummary {
  const { videoUrl: _v, questions, answers: _a, ...rest } = m;
  return { ...rest, questionCount: questions.length, progress: progress.get(m.id) ?? fresh() };
}

/** Failed attempts in a row, per module, for the server's three-then-wait rule. */
const failures = new Map<string, { count: number; lastAt: number }>();
const QUIZ_TRIES = 3;
const QUIZ_COOLDOWN_MS = 24 * 3_600_000;

function find(id: string): Module {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new ApiError("This module isn't available.", 404, "NOT_FOUND", false);
  return m;
}

export const previewTrainingApi = {
  training: () => {
    const items = MODULES.map(summary);
    return delay({ items, completed: items.filter((i) => i.progress.status === "COMPLETED").length, total: items.length });
  },
  trainingModule: (id) => {
    try {
      const m = find(id);
      const { answers: _a, ...rest } = m;
      return delay({ ...rest, questionCount: m.questions.length, progress: progress.get(id) ?? fresh(), passMark: 0.8, watchedAt: 0.9 });
    } catch (e) {
      return Promise.reject(e);
    }
  },
  setTrainingProgress: (id, body) =>
    once(body.clientEventId, () => {
      const m = find(id);
      const p = progress.get(id) ?? fresh();
      const videoProgress = Math.max(p.videoProgress, Math.min(1, Math.max(0, body.videoProgress)));
      let next: TrainingProgress = { ...p, videoProgress, status: p.status === "NOT_STARTED" && videoProgress > 0 ? "IN_PROGRESS" : p.status };
      if (body.markComplete) {
        if (videoProgress < 0.9) throw new ApiError("Watch the video first.", 409, "NOT_WATCHED", false);
        if (m.questions.length === 0 || (p.quizScore ?? 0) >= 0.8) next = { ...next, status: "COMPLETED", completedAt: new Date().toISOString() };
      }
      progress.set(id, next);
      return next;
    }),
  submitQuiz: (id, body) =>
    once(body.clientEventId, () => {
      const m = find(id);
      if (m.questions.length === 0) throw new ApiError("This module has no quiz.", 409, "NO_QUIZ", false);
      const failed = failures.get(id);
      if (failed && failed.count >= QUIZ_TRIES) {
        if (Date.now() - failed.lastAt < QUIZ_COOLDOWN_MS) {
          throw new ApiError("You've had three tries. You can try again this time tomorrow.", 429, "QUIZ_COOLDOWN", false);
        }
        failures.delete(id);
      }
      const answered = new Set(body.answers.map((a) => a.questionId));
      if (answered.size !== m.questions.length || m.questions.some((q) => !answered.has(q.id))) {
        throw new ApiError("Answer every question once.", 400, "VALIDATION", false);
      }
      const correct = m.questions.filter((q, i) => body.answers.find((a) => a.questionId === q.id)?.selectedIndex === m.answers[i]).length;
      const total = m.questions.length;
      const score = correct / total;
      const passed = score >= 0.8;
      const p = progress.get(id) ?? fresh();
      const status = passed ? (p.videoProgress >= 0.9 ? "COMPLETED" : "IN_PROGRESS") : "FAILED";
      if (passed) failures.delete(id);
      else failures.set(id, { count: (failures.get(id)?.count ?? 0) + 1, lastAt: Date.now() });
      const next: TrainingProgress = {
        ...p,
        quizScore: score,
        quizAttempts: p.quizAttempts + 1,
        status,
        completedAt: status === "COMPLETED" ? new Date().toISOString() : null,
      };
      progress.set(id, next);
      return { score, passed, correct, total, progress: next };
    }, 700),
} satisfies Pick<DataSource, "training" | "trainingModule" | "setTrainingProgress" | "submitQuiz">;
