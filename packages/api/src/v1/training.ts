// Training: the modules a cleaner works through — a description, usually a
// video, and sometimes a short quiz — and where they stand on each.
//
// Everything is the CALLER'S OWN progress. Only active modules are visible;
// an inactive or unknown module answers 404. Quiz answers are marked on the
// server: which option is correct is never sent to the phone.
import { z } from "zod";

import { Instant, openEnum } from "./common";

export const TRAINING_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;

/** Where the caller stands on one module. */
export const TrainingProgress = z.object({
  status: openEnum(TRAINING_STATUSES),
  /** 0 to 1: how much of the video the server has on record as watched. */
  videoProgress: z.number(),
  /** 0 to 1: the most recent quiz score, as the web keeps it. Null before any attempt. */
  quizScore: z.number().nullable(),
  quizAttempts: z.number().int(),
  completedAt: Instant.nullable(),
});
export type TrainingProgress = z.infer<typeof TrainingProgress>;

/** A module as the list shows it. */
export const TrainingModuleSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  hasVideo: z.boolean(),
  /** The video's length, when the office entered it. */
  durationSeconds: z.number().int().nullable(),
  isRequired: z.boolean(),
  questionCount: z.number().int(),
  /** Not-started modules come back as NOT_STARTED with zeros, never null. */
  progress: TrainingProgress,
});
export type TrainingModuleSummary = z.infer<typeof TrainingModuleSummary>;

/**
 * GET /api/v1/training — every active module, in the office's order
 * (sortOrder, then created), with the caller's progress.
 *
 * Server: staff only; progress rows WHERE employeeId = session user. Never
 * returns other people's progress or quiz answers.
 */
export const TrainingListResponse = z.object({
  items: z.array(TrainingModuleSummary),
  /** For the More row's "6/7": completed of all active modules. */
  completed: z.number().int(),
  total: z.number().int(),
});
export type TrainingListResponse = z.infer<typeof TrainingListResponse>;

/**
 * GET /api/v1/training/:moduleId — one active module, to work through.
 *
 * Server: 404 unless the module exists and is active. `questions` carry the
 * option TEXT only; `isCorrect` stays on the server. `videoUrl` is sent only
 * when it is an http(s) URL; anything else is sent as null.
 */
export const TrainingModuleDetail = TrainingModuleSummary.extend({
  /** YouTube, Vimeo or a file. The app opens it with the phone's own player. */
  videoUrl: z.string().nullable(),
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.object({ text: z.string() })),
    }),
  ),
  /** The share of answers needed to pass: 0.8 today. */
  passMark: z.number(),
  /** How much of the video counts as watched: 0.9 today. */
  watchedAt: z.number(),
});
export type TrainingModuleDetail = z.infer<typeof TrainingModuleDetail>;

/**
 * POST /api/v1/training/:moduleId/progress — "I've watched the video".
 * Idempotent on `clientEventId`.
 *
 * Server: as `updateTrainingProgress` for the session user and an ACTIVE
 * module: clamps `videoProgress` to 0..1 and only ever raises it; with
 * `markComplete`, requires video progress at or past `watchedAt`, and
 * completes the module when it has no quiz or the quiz is already passed.
 * Returns the caller's progress.
 */
export const TrainingProgressRequest = z.object({
  clientEventId: z.uuid(),
  videoProgress: z.number().min(0).max(1),
  markComplete: z.boolean().optional(),
});
export type TrainingProgressRequest = z.infer<typeof TrainingProgressRequest>;

/**
 * POST /api/v1/training/:moduleId/quiz — submit answers. Idempotent on
 * `clientEventId`: a retry is not a second attempt.
 *
 * Server: as `submitQuiz` for the session user and an ACTIVE module with a
 * quiz (no quiz → 409 `NO_QUIZ`). Each questionId must belong to this module
 * and each index must be one of its options (400 otherwise). Marks on the
 * server, stores the score, adds one attempt, and sets COMPLETED (passed and
 * watched), IN_PROGRESS (passed, video not yet watched) or FAILED.
 */
export const QuizSubmitRequest = z.object({
  clientEventId: z.uuid(),
  answers: z
    .array(z.object({ questionId: z.string().min(1), selectedIndex: z.number().int().min(0).max(20) }))
    .min(1)
    .max(100),
});
export type QuizSubmitRequest = z.infer<typeof QuizSubmitRequest>;

export const QuizSubmitResponse = z.object({
  score: z.number(),
  passed: z.boolean(),
  correct: z.number().int(),
  total: z.number().int(),
  progress: TrainingProgress,
});
export type QuizSubmitResponse = z.infer<typeof QuizSubmitResponse>;
