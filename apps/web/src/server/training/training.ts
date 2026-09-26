// Training: modules, the caller's own progress on them, and quizzes marked on
// the server (packages/api/src/v1/training.ts).
//
// Everything is the CALLER'S OWN progress (employeeId = actor.userId) and
// only ACTIVE modules are reachable; an inactive or unknown module is 404.
// Which option is correct never leaves this file.
//
// Both front doors use this: the web's updateTrainingProgress / submitQuiz
// actions and /api/v1/training/*. Rules the contract made stricter than the
// web had them apply to both (see the functions' comments).
import "server-only";

import type { Prisma } from "@prisma/client";

import { cloudinaryConfigured } from "@/lib/cloudinary";
import { currentOrgSlug } from "@/lib/asset-folder";
import type { ScopedTx } from "@/lib/db-scoped";
import { db } from "@/lib/org-db";
import { addStoreDays, formatDate, formatTime, storeDateKey } from "@/lib/timezone";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Result } from "../result";
import { cloudName, signCompanyFile } from "../storage/company-file-sign";
import { parseCompanyFileUrl, publicVideoUrl } from "../storage/company-file-url";

/** The share of answers needed to pass. */
export const PASS_MARK = 0.8;
/** How much of the video counts as watched. */
export const WATCHED_AT = 0.9;
/** Failed attempts in a row before a wait. */
export const QUIZ_MAX_FAILS = 3;
export const QUIZ_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type Status = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface TrainingProgressView {
  status: Status;
  videoProgress: number;
  quizScore: number | null;
  quizAttempts: number;
  completedAt: string | null;
}

export interface TrainingModuleSummaryView {
  id: string;
  title: string;
  description: string | null;
  hasVideo: boolean;
  durationSeconds: number | null;
  isRequired: boolean;
  questionCount: number;
  progress: TrainingProgressView;
}

export interface TrainingModuleDetailView extends TrainingModuleSummaryView {
  videoUrl: string | null;
  questions: { id: string; question: string; options: { text: string }[] }[];
  passMark: number;
  watchedAt: number;
}

type ProgressRow = {
  status: Status;
  videoProgress: number;
  quizScore: number | null;
  quizAttempts: number;
  completedAt: Date | null;
};

const NOT_STARTED: TrainingProgressView = {
  status: "NOT_STARTED",
  videoProgress: 0,
  quizScore: null,
  quizAttempts: 0,
  completedAt: null,
};

function progressView(p: ProgressRow | null | undefined): TrainingProgressView {
  if (!p) return NOT_STARTED;
  return {
    status: p.status,
    videoProgress: p.videoProgress,
    quizScore: p.quizScore,
    quizAttempts: p.quizAttempts,
    completedAt: p.completedAt?.toISOString() ?? null,
  };
}

const PROGRESS_SELECT = {
  status: true,
  videoProgress: true,
  quizScore: true,
  quizAttempts: true,
  completedAt: true,
} as const;

/** Option TEXT only: `isCorrect` is read on the server and never copied out. */
function optionsOf(raw: Prisma.JsonValue): { text: string; isCorrect: boolean }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    const obj = (o && typeof o === "object" && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
    return { text: typeof obj.text === "string" ? obj.text : "", isCorrect: obj.isCorrect === true };
  });
}

/**
 * The video link the phone may open, or null: https on youtube.com, youtu.be
 * or vimeo.com (or a subdomain), or a file on the company's own storage as a
 * short-lived signed URL. Anything else the office typed in is not passed on.
 */
async function videoLinkFor(raw: string | null, mint: boolean): Promise<string | null> {
  if (!raw) return null;
  const external = publicVideoUrl(raw);
  if (external) return external;
  if (!cloudinaryConfigured()) return null;
  const file = parseCompanyFileUrl(raw, { cloudName: cloudName(), orgSlug: await currentOrgSlug() });
  if (!file || file.resourceType !== "video") return null;
  // The list only needs to know there is one; the link is made for the detail.
  return mint ? signCompanyFile(file) : "company-file";
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Every active module, in the office's order, with the caller's progress. */
export async function listTrainingFor(
  actor: Actor,
): Promise<Result<{ items: TrainingModuleSummaryView[]; completed: number; total: number }>> {
  const modules = await db.trainingModule.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      videoUrl: true,
      duration: true,
      isRequired: true,
      _count: { select: { quizzes: true } },
      progress: { where: { employeeId: actor.userId }, take: 1, select: PROGRESS_SELECT },
    },
  });
  const items: TrainingModuleSummaryView[] = [];
  for (const m of modules) {
    items.push({
      id: m.id,
      title: m.title,
      description: m.description,
      hasVideo: (await videoLinkFor(m.videoUrl, false)) !== null,
      durationSeconds: m.duration,
      isRequired: m.isRequired,
      questionCount: m._count.quizzes,
      progress: progressView(m.progress[0] as ProgressRow | undefined),
    });
  }
  return ok({
    items,
    completed: items.filter((i) => i.progress.status === "COMPLETED").length,
    total: items.length,
  });
}

/** One active module to work through. Questions carry option text only. */
export async function trainingModuleFor(actor: Actor, moduleId: string): Promise<Result<TrainingModuleDetailView>> {
  const m = await db.trainingModule.findFirst({
    where: { id: moduleId, isActive: true },
    select: {
      id: true,
      title: true,
      description: true,
      videoUrl: true,
      duration: true,
      isRequired: true,
      quizzes: { orderBy: { sortOrder: "asc" }, select: { id: true, question: true, options: true } },
      progress: { where: { employeeId: actor.userId }, take: 1, select: PROGRESS_SELECT },
    },
  });
  if (!m) return notFound("This module isn't available.");
  const videoUrl = await videoLinkFor(m.videoUrl, true);
  return ok({
    id: m.id,
    title: m.title,
    description: m.description,
    hasVideo: videoUrl !== null,
    durationSeconds: m.duration,
    isRequired: m.isRequired,
    questionCount: m.quizzes.length,
    progress: progressView(m.progress[0] as ProgressRow | undefined),
    videoUrl,
    questions: m.quizzes.map((q) => ({
      id: q.id,
      question: q.question,
      options: optionsOf(q.options).map((o) => ({ text: o.text })),
    })),
    passMark: PASS_MARK,
    watchedAt: WATCHED_AT,
  });
}

// ── Writing ─────────────────────────────────────────────────────────────────

type Tx = ScopedTx;

interface LockedProgress {
  id: string;
  status: Status;
  videoProgress: number;
  quizScore: number | null;
  quizFailStreak: number;
  quizCooldownUntil: Date | null;
  completedAt: Date | null;
}

/**
 * The caller's progress row for a module, created if missing and locked for
 * the rest of the transaction, so two submissions at once are applied one
 * after the other: an attempt can't be lost, the video can't go backwards,
 * and the cooldown can't be raced.
 */
async function lockProgress(tx: Tx, actor: Actor, moduleId: string): Promise<LockedProgress> {
  await tx.trainingProgress.createMany({
    data: [{ moduleId, employeeId: actor.userId, status: "NOT_STARTED" }],
    skipDuplicates: true,
  });
  const rows = await tx.$queryRaw<LockedProgress[]>`
    SELECT "id", "status"::text AS "status", "videoProgress", "quizScore", "quizFailStreak",
           "quizCooldownUntil", "completedAt"
    FROM "TrainingProgress"
    WHERE "moduleId" = ${moduleId} AND "employeeId" = ${actor.userId}
      AND "organizationId" = ${actor.organizationId}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error("training progress row missing after create");
  return row;
}

const MESSAGES = {
  notFound: "Module not found",
  notWatched: "Watch at least 90% to mark complete",
  noQuiz: "Module has no quiz",
  answerAll: "Answer every question once.",
} as const;

export interface TrainingProgressInput {
  moduleId: string;
  videoProgress?: number;
  markComplete?: boolean;
  now: Date;
}

/**
 * "I've watched the video" / "I've read it", for the caller and an ACTIVE
 * module. Video progress is clamped to 0..1 and only ever raised. With
 * markComplete, it must reach WATCHED_AT, and the module completes when it has
 * no quiz or the quiz is already passed. Stored as SELF-ATTESTED: it is the
 * person's word, not something the server saw.
 *
 * Stricter than the web had it, for both front doors: an inactive module is
 * refused, and progress never goes backwards.
 */
export async function setTrainingProgressFor(
  actor: Actor,
  input: TrainingProgressInput,
): Promise<Result<TrainingProgressView>> {
  const moduleRow = await db.trainingModule.findFirst({
    where: { id: input.moduleId, isActive: true },
    select: { id: true, _count: { select: { quizzes: true } } },
  });
  if (!moduleRow) return notFound(MESSAGES.notFound);
  const hasQuiz = moduleRow._count.quizzes > 0;
  const sent =
    input.videoProgress !== undefined && Number.isFinite(input.videoProgress)
      ? Math.min(1, Math.max(0, input.videoProgress))
      : undefined;

  return db.$transaction(async (tx) => {
    const cur = await lockProgress(tx, actor, input.moduleId);
    const video = Math.max(cur.videoProgress, sent ?? 0);

    const data: Prisma.TrainingProgressUpdateInput = {};
    if (sent !== undefined) {
      data.videoProgress = video;
      if (video > 0) data.selfAttested = true;
      if (video > 0 && cur.status === "NOT_STARTED") data.status = "IN_PROGRESS";
    }

    if (input.markComplete) {
      if (video < WATCHED_AT) return failure(409, "NOT_WATCHED", MESSAGES.notWatched);
      data.selfAttested = true;
      const quizPassed = cur.quizScore !== null && cur.quizScore >= PASS_MARK;
      if (!hasQuiz || quizPassed) {
        data.status = "COMPLETED";
        // A module already complete keeps the day it was completed.
        data.completedAt = cur.status === "COMPLETED" && cur.completedAt ? cur.completedAt : input.now;
      } else {
        data.status = cur.status === "FAILED" ? "FAILED" : "IN_PROGRESS";
      }
    }
    // Any progress report means the module is started, as the web's upsert
    // always made it.
    if (data.status === undefined && cur.status === "NOT_STARTED") data.status = "IN_PROGRESS";

    const updated = await tx.trainingProgress.update({
      where: { id: cur.id },
      data,
      select: PROGRESS_SELECT,
    });
    return ok(progressView(updated as ProgressRow));
  });
}

export interface QuizAnswer {
  questionId: string;
  selectedIndex: number;
}

export interface QuizResultView {
  score: number;
  passed: boolean;
  correct: number;
  total: number;
  progress: TrainingProgressView;
}

/** "You can try again after 3:40 pm tomorrow.", in the company's own zone. */
export function cooldownMessage(until: Date, now: Date): string {
  const time = formatTime(until).replace(/\s?AM$/, " am").replace(/\s?PM$/, " pm");
  const day = storeDateKey(until);
  const when =
    day === storeDateKey(now)
      ? "today"
      : day === storeDateKey(addStoreDays(now, 1))
        ? "tomorrow"
        : `on ${formatDate(until, { weekday: "long", month: "long", day: "numeric" })}`;
  return `You can try again after ${time} ${when}.`;
}

/**
 * Mark a quiz, for the caller and an ACTIVE module with one (else 409
 * NO_QUIZ). Every question is answered exactly once, and each index is one of
 * its options (400 otherwise); `total` is the module's question count. Stores
 * the score, adds an attempt, and sets COMPLETED (passed and watched),
 * IN_PROGRESS (passed, not yet watched) or FAILED.
 *
 * After QUIZ_MAX_FAILS failures in a row the next attempt is 429
 * QUIZ_COOLDOWN until 24 hours after the last of them; then the count starts
 * again. A pass resets it.
 *
 * Stricter than the web had it, for both front doors: the exactly-once rule
 * (the web page always sends every question once, so it is unaffected), the
 * cooldown, and an inactive module being refused.
 */
export async function submitQuizFor(
  actor: Actor,
  input: { moduleId: string; answers: QuizAnswer[]; now: Date },
): Promise<Result<QuizResultView>> {
  const moduleRow = await db.trainingModule.findFirst({
    where: { id: input.moduleId, isActive: true },
    select: { id: true, quizzes: { select: { id: true, options: true } } },
  });
  if (!moduleRow) return notFound(MESSAGES.notFound);
  const quizzes = moduleRow.quizzes;
  if (quizzes.length === 0) return failure(409, "NO_QUIZ", MESSAGES.noQuiz);

  // Every question of this module, each exactly once, each a real option.
  const byId = new Map(quizzes.map((q) => [q.id, optionsOf(q.options)]));
  const seen = new Set<string>();
  let correct = 0;
  for (const a of input.answers) {
    const options = byId.get(a.questionId);
    if (!options || seen.has(a.questionId)) return failure(400, "VALIDATION_FAILED", MESSAGES.answerAll);
    if (!Number.isInteger(a.selectedIndex) || a.selectedIndex < 0 || a.selectedIndex >= options.length) {
      return failure(400, "VALIDATION_FAILED", MESSAGES.answerAll);
    }
    seen.add(a.questionId);
    if (options[a.selectedIndex]!.isCorrect) correct++;
  }
  if (seen.size !== quizzes.length) return failure(400, "VALIDATION_FAILED", MESSAGES.answerAll);

  const total = quizzes.length;
  const score = correct / total;
  const passed = score >= PASS_MARK;

  return db.$transaction(async (tx) => {
    const cur = await lockProgress(tx, actor, input.moduleId);
    const now = input.now;
    if (cur.quizCooldownUntil && now.getTime() < cur.quizCooldownUntil.getTime()) {
      return failure(429, "QUIZ_COOLDOWN", cooldownMessage(cur.quizCooldownUntil, now));
    }
    // A wait that is over starts the count again.
    const streak = cur.quizCooldownUntil ? 0 : cur.quizFailStreak;
    const nextStreak = passed ? 0 : streak + 1;
    const cooldown = !passed && nextStreak >= QUIZ_MAX_FAILS ? new Date(now.getTime() + QUIZ_COOLDOWN_MS) : null;

    const watched = cur.videoProgress >= WATCHED_AT;
    const status: Status = passed ? (watched ? "COMPLETED" : "IN_PROGRESS") : "FAILED";

    const updated = await tx.trainingProgress.update({
      where: { id: cur.id },
      data: {
        quizScore: score,
        quizAttempts: { increment: 1 },
        status,
        completedAt: status === "COMPLETED" ? now : null,
        quizFailStreak: nextStreak,
        quizCooldownUntil: cooldown,
      },
      select: PROGRESS_SELECT,
    });
    return ok({ score, passed, correct, total, progress: progressView(updated as ProgressRow) });
  });
}
