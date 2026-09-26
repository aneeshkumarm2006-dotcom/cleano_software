/**
 * API v1 integration checks for the record area: training, documents,
 * strikes. Run by scripts/api-v1-integration.ts against a local server on
 * STAGING, inside the two throwaway companies of ./fixture.ts. Every row made
 * here carries one of those companies' ids, so removeFixture deletes it.
 *
 * Covers each endpoint's happy path, not-yours (404), wrong role (403),
 * validation (400), idempotent replay, and the contract's special rules:
 * answers never leak, video links only from allowed hosts, quiz answered
 * exactly once, the 3-failure cooldown (a replay not counted), progress only
 * rising and self-attested, void cheque metadata only, the echoed hash and
 * version (DOCUMENT_CHANGED), the server-drawn signature image and the
 * evidence kept with it, and strikes never carrying the admin's note, who
 * gave them, or the client.
 */
import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { PASSWORD, type Fixture } from "./fixture";

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

type CallOpts = { cookie?: string; body?: unknown; headers?: Record<string, string>; noAppHeaders?: boolean };

export interface RecordHarness {
  db: PrismaClient;
  fx: Fixture;
  hostA: string;
  hostB: string;
  /** The cleaner's app session in company A. */
  cookie: string;
  call: (method: string, host: string, path: string, opts?: CallOpts) => Promise<Res>;
  check: (name: string, ok: boolean, detail?: unknown) => void;
  signIn: (host: string, email: string, password?: string, expo?: boolean) => Promise<string>;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const line = (x0: number, y0: number, x1: number, y1: number, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const SIGNATURE = { width: 600, height: 200, strokes: [line(40, 120, 300, 90), line(300, 90, 420, 150)] };

export async function recordChecks(t: RecordHarness): Promise<void> {
  const { db, fx: F, hostA, hostB, cookie, call, check, signIn } = t;
  const A = F.orgA.id;
  const B = F.orgB.id;
  const cleaner = F.users.cleaner.id;
  const teammate = F.users.teammate.id;
  const post = (path: string, who: string, body: Record<string, unknown>, opts: { key?: string | null; headers?: Record<string, string>; host?: string } = {}) => {
    const key = opts.key === null ? undefined : (opts.key ?? (body.clientEventId as string | undefined));
    return call("POST", opts.host ?? hostA, path, {
      cookie: who,
      body,
      headers: { ...(key ? { "Idempotency-Key": key } : {}), ...opts.headers },
    });
  };

  const owner = await signIn(hostA, F.users.owner.email, PASSWORD);
  const mate = await signIn(hostA, F.users.teammate.email, PASSWORD);
  const bCleaner = await signIn(hostB, F.users.bCleaner.email, PASSWORD);

  // ── Test data ─────────────────────────────────────────────────────────────
  const opts = (correct: number) =>
    ["Bleach", "Vinegar", "Water"].map((text, i) => ({ text, isCorrect: i === correct }));
  const m1 = await db.trainingModule.create({
    data: {
      organizationId: A,
      title: "V1 Chemicals",
      description: "Which products never mix.",
      videoUrl: "https://www.youtube.com/watch?v=v1test",
      duration: 300,
      isRequired: true,
      sortOrder: 1,
      quizzes: {
        create: [
          { organizationId: A, question: "Never mix with ammonia?", options: opts(0), sortOrder: 1 },
          { organizationId: A, question: "Safe on glass?", options: opts(1), sortOrder: 2 },
        ],
      },
    },
    select: { id: true, quizzes: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
  });
  const [q1, q2] = [m1.quizzes[0]!.id, m1.quizzes[1]!.id];
  const m2 = await db.trainingModule.create({
    data: { organizationId: A, title: "V1 Reading", videoUrl: "https://evil.test/v.mp4", sortOrder: 2 },
    select: { id: true },
  });
  const m3 = await db.trainingModule.create({
    data: { organizationId: A, title: "V1 Retired", isActive: false, sortOrder: 3 },
    select: { id: true },
  });
  const mB = await db.trainingModule.create({
    data: {
      organizationId: B,
      title: "V1 Other company",
      quizzes: { create: [{ organizationId: B, question: "B?", options: opts(0) }] },
    },
    select: { id: true, quizzes: { select: { id: true } } },
  });

  const doc = (organizationId: string, title: string, extra: { content?: string; fileUrl?: string; version?: string } = {}) =>
    db.document.create({
      data: { organizationId, title, description: "For the v1 tests.", version: extra.version ?? "2", ...extra },
      select: { id: true },
    });
  const assign = (organizationId: string, documentId: string, employeeId: string, status: "PENDING" | "REVOKED" | "EXPIRED" = "PENDING") =>
    db.documentSignature.create({ data: { organizationId, documentId, employeeId, status } });
  const CONTENT = "Keep client keys in the lockbox.\nNever share door codes.";
  const DRIVE = "https://drive.google.com/file/d/v1test/view";
  const dText = await doc(A, "V1 Key policy", { content: CONTENT });
  const dFile = await doc(A, "V1 Handbook", { fileUrl: DRIVE });
  const dChanging = await doc(A, "V1 Changing", { content: "First wording." });
  const dRevoked = await doc(A, "V1 Revoked", { content: "x" });
  const dExpired = await doc(A, "V1 Expired", { content: "y" });
  const dMate = await doc(A, "V1 Teammate only", { content: "z" });
  const dB = await doc(B, "V1 Company B", { content: "b" });
  await assign(A, dText.id, cleaner);
  await assign(A, dFile.id, cleaner);
  await assign(A, dChanging.id, cleaner);
  await assign(A, dRevoked.id, cleaner, "REVOKED");
  await assign(A, dExpired.id, cleaner, "EXPIRED");
  await assign(A, dMate.id, teammate);
  await assign(A, dB.id, F.users.bCleaner.id);
  const CHEQUE_URL = "https://res.cloudinary.com/v1test/raw/authenticated/awer/v1test-alpha/secret-cheque.pdf";
  await db.employeeFile.create({
    data: {
      organizationId: A,
      employeeId: cleaner,
      kind: "VOID_CHEQUE",
      fileUrl: CHEQUE_URL,
      publicId: "awer/v1test-alpha/secret-cheque",
      resourceType: "raw",
      fileName: "cheque.pdf",
      mimeType: "application/pdf",
    },
  });

  const day = 24 * 3600_000;
  const now = Date.now();
  const strike = (data: Record<string, unknown>) =>
    db.cleanerStrike.create({ data: { organizationId: A, cleanerId: cleaner, reasonCode: "LATE_45", reason: "45+ minutes late without approved notice — 50 min late to job #9000", expiresAt: new Date(now + 20 * day), ...data } as never });
  // The clock checks earlier in the run may have given this cleaner real
  // lateness strikes; the checks below allow for those.
  const sActive = await strike({ jobId: F.jobs.mine, adminNote: "SECRET-ADMIN-NOTE", appliedById: F.users.owner.id, isAuto: false });
  const sRolled = await strike({ reasonCode: "NO_SHOW", reason: "No-show", expiresAt: new Date(now - day), createdAt: new Date(now - 31 * day) });
  const sExcused = await strike({ reasonCode: "MANUAL", reason: "Manual strike", status: "EXCUSED", excusedById: F.users.owner.id, excusedAt: new Date(), createdAt: new Date(now - 5 * day) });
  await db.cleanerStrike.create({
    data: { organizationId: A, cleanerId: teammate, reasonCode: "NO_SHOW", reason: "No-show", expiresAt: new Date(now + 20 * day) },
  });

  // ── Training: reading ─────────────────────────────────────────────────────
  {
    const r = await call("GET", hostA, "/api/v1/training", { cookie });
    const ids = (r.body?.items ?? []).map((i: { id: string }) => i.id);
    check("training: 200, active modules in the office's order", r.status === 200 && ids.join() === [m1.id, m2.id].join(), r.body);
    check("training: completed/total count active modules", r.body?.total === 2 && r.body?.completed === 0, r.body);
    const first = r.body?.items?.[0];
    check(
      "training: a module not started is NOT_STARTED with zeros",
      first?.progress?.status === "NOT_STARTED" && first.progress.videoProgress === 0 && first.progress.quizScore === null && first.questionCount === 2,
      first,
    );
    check("training: the list never carries answers", !/isCorrect/i.test(r.text));
    const owned = await call("GET", hostA, "/api/v1/training", { cookie: owner });
    check("training: an owner is 403 ROLE_NOT_ALLOWED (crew only)", owned.status === 403 && owned.body?.error?.code === "ROLE_NOT_ALLOWED", owned.body);
    const none = await call("GET", hostA, "/api/v1/training");
    check("training: no session is 401", none.status === 401, none.body);
  }
  {
    const r = await call("GET", hostA, `/api/v1/training/${m1.id}`, { cookie });
    const q = r.body?.questions ?? [];
    check(
      "training module: questions carry option text only",
      r.status === 200 && q.length === 2 && q[0].options.length === 3 && Object.keys(q[0].options[0]).join() === "text",
      r.body,
    );
    check("training module: no answer anywhere in the response", !/isCorrect|"correct"/i.test(r.text));
    check("training module: a YouTube link is sent", r.body?.videoUrl === "https://www.youtube.com/watch?v=v1test" && r.body?.hasVideo === true, r.body?.videoUrl);
    check("training module: passMark 0.8, watchedAt 0.9", r.body?.passMark === 0.8 && r.body?.watchedAt === 0.9, r.body);
    const two = await call("GET", hostA, `/api/v1/training/${m2.id}`, { cookie });
    check("training module: a link to anywhere else is sent as null", two.status === 200 && two.body?.videoUrl === null && two.body?.hasVideo === false, two.body);
    const inactive = await call("GET", hostA, `/api/v1/training/${m3.id}`, { cookie });
    check("training module: an inactive module is 404", inactive.status === 404, inactive.body);
    const other = await call("GET", hostA, `/api/v1/training/${mB.id}`, { cookie });
    check("training module: another company's module is 404", other.status === 404, other.body);
    const junk = await call("GET", hostA, "/api/v1/training/..%2F..%2Fx", { cookie });
    check("training module: a malformed id is 404", junk.status === 404, junk.status);
  }

  // ── Training: progress ────────────────────────────────────────────────────
  const progress = (moduleId: string, body: Record<string, unknown>, who = cookie, key?: string | null) =>
    post(`/api/v1/training/${moduleId}/progress`, who, { clientEventId: randomUUID(), ...body }, { key });
  {
    const e = { clientEventId: randomUUID(), videoProgress: 0.5 };
    const r = await post(`/api/v1/training/${m1.id}/progress`, cookie, e);
    check("progress: 200, started", r.status === 200 && r.body?.status === "IN_PROGRESS" && r.body?.videoProgress === 0.5, r.body);
    const row = await db.trainingProgress.findFirst({ where: { moduleId: m1.id, employeeId: cleaner } });
    check("progress: stored as self-attested", row?.selfAttested === true, row);
    const again = await post(`/api/v1/training/${m1.id}/progress`, cookie, e);
    check("progress: a replay answers the stored result", again.headers["idempotent-replayed"] === "true" && again.body?.videoProgress === 0.5, again.body);
    const lower = await progress(m1.id, { videoProgress: 0.2 });
    check("progress: never goes backwards", lower.status === 200 && lower.body?.videoProgress === 0.5, lower.body);
    const early = await progress(m1.id, { videoProgress: 0.5, markComplete: true });
    check("progress: marking complete before 90% is 409 NOT_WATCHED", early.status === 409 && early.body?.error?.code === "NOT_WATCHED", early.body);
    const bad = await progress(m1.id, { videoProgress: 1.5 });
    check("progress: videoProgress over 1 is 400", bad.status === 400 && bad.body?.error?.code === "VALIDATION_FAILED", bad.body);
    const noKey = await progress(m1.id, { videoProgress: 0.6 }, cookie, null);
    check("progress: no Idempotency-Key is 400", noKey.status === 400 && noKey.body?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", noKey.body);
    const inactive = await progress(m3.id, { videoProgress: 0.5 });
    check("progress: an inactive module is 404", inactive.status === 404, inactive.body);
    const other = await progress(mB.id, { videoProgress: 0.5 });
    check("progress: another company's module is 404", other.status === 404, other.body);
    const owned = await progress(m1.id, { videoProgress: 0.5 }, owner);
    check("progress: an owner is 403", owned.status === 403, owned.body);
  }

  // ── Training: quiz ────────────────────────────────────────────────────────
  const quiz = (moduleId: string, answers: unknown, clientEventId = randomUUID()) =>
    post(`/api/v1/training/${moduleId}/quiz`, cookie, { clientEventId, answers });
  const right = [
    { questionId: q1, selectedIndex: 0 },
    { questionId: q2, selectedIndex: 1 },
  ];
  const wrong = [
    { questionId: q1, selectedIndex: 2 },
    { questionId: q2, selectedIndex: 2 },
  ];
  {
    const missing = await quiz(m1.id, [right[0]]);
    check("quiz: a missing question is 400", missing.status === 400, missing.body);
    const dup = await quiz(m1.id, [right[0], right[0], right[1]]);
    check("quiz: a repeated question is 400", dup.status === 400, dup.body);
    const foreign = await quiz(m1.id, [right[0], { questionId: mB.quizzes[0]!.id, selectedIndex: 0 }]);
    check("quiz: a question from another module is 400", foreign.status === 400, foreign.body);
    const range = await quiz(m1.id, [right[0], { questionId: q2, selectedIndex: 7 }]);
    check("quiz: an index past the options is 400", range.status === 400, range.body);
    const noQuiz = await quiz(m2.id, [right[0]]);
    check("quiz: a module with no quiz is 409 NO_QUIZ", noQuiz.status === 409 && noQuiz.body?.error?.code === "NO_QUIZ", noQuiz.body);
    const rows0 = await db.trainingProgress.findFirst({ where: { moduleId: m1.id, employeeId: cleaner } });
    check("quiz: refused answers are not attempts", rows0?.quizAttempts === 0, rows0?.quizAttempts);

    const id1 = randomUUID();
    const f1 = await quiz(m1.id, wrong, id1);
    check(
      "quiz: marked on the server; total is the module's count",
      f1.status === 200 && f1.body?.passed === false && f1.body?.correct === 0 && f1.body?.total === 2 && f1.body?.progress?.status === "FAILED",
      f1.body,
    );
    const replay = await quiz(m1.id, wrong, id1);
    const afterReplay = await db.trainingProgress.findFirst({ where: { moduleId: m1.id, employeeId: cleaner } });
    check("quiz: a replay is not a second attempt", replay.headers["idempotent-replayed"] === "true" && afterReplay?.quizAttempts === 1, afterReplay?.quizAttempts);
    const f2 = await quiz(m1.id, wrong);
    const f3 = await quiz(m1.id, wrong);
    check("quiz: second and third failures are answered", f2.status === 200 && f3.status === 200, [f2.body, f3.body]);
    const locked = await quiz(m1.id, right);
    check(
      "quiz: after 3 failures, 429 QUIZ_COOLDOWN, not retryable, saying when",
      locked.status === 429 && locked.body?.error?.code === "QUIZ_COOLDOWN" && locked.body?.error?.retryable === false && /^You can try again after \d{1,2}:\d{2} (am|pm) (today|tomorrow)\.$/.test(locked.body?.error?.message ?? ""),
      locked.body,
    );
    const row = await db.trainingProgress.findFirst({ where: { moduleId: m1.id, employeeId: cleaner } });
    const waitMs = row?.quizCooldownUntil ? row.quizCooldownUntil.getTime() - Date.now() : 0;
    check("quiz: the wait is 24 hours from the third failure", row?.quizAttempts === 3 && waitMs > 23.9 * 3600_000 && waitMs <= 24 * 3600_000, { attempts: row?.quizAttempts, waitMs });

    await db.trainingProgress.update({ where: { id: row!.id }, data: { quizCooldownUntil: new Date(Date.now() - 1000) } });
    const passed = await quiz(m1.id, right);
    check(
      "quiz: once the wait is over, a pass with the video unwatched is IN_PROGRESS",
      passed.status === 200 && passed.body?.passed === true && passed.body?.score === 1 && passed.body?.progress?.status === "IN_PROGRESS",
      passed.body,
    );
    const reset = await db.trainingProgress.findFirst({ where: { moduleId: m1.id, employeeId: cleaner } });
    check("quiz: a pass starts the count again", reset?.quizFailStreak === 0 && reset?.quizCooldownUntil === null, reset);

    const done = await progress(m1.id, { videoProgress: 0.95, markComplete: true });
    check("progress: watched with the quiz passed completes the module", done.status === 200 && done.body?.status === "COMPLETED" && !!done.body?.completedAt, done.body);
    const list = await call("GET", hostA, "/api/v1/training", { cookie });
    check("training: the count moves to 1 of 2", list.body?.completed === 1 && list.body?.total === 2, list.body);
    const theirs = await call("GET", hostA, `/api/v1/training/${m1.id}`, { cookie: mate });
    check("training: a teammate's progress is their own", theirs.body?.progress?.status === "NOT_STARTED", theirs.body?.progress);
  }

  // ── Documents: reading ────────────────────────────────────────────────────
  {
    const r = await call("GET", hostA, "/api/v1/documents", { cookie });
    const ids: string[] = (r.body?.items ?? []).map((i: { id: string }) => i.id).sort();
    const expected = [dText.id, dFile.id, dChanging.id, dRevoked.id, dExpired.id].sort();
    check("documents: 200, only the caller's own", r.status === 200 && ids.join() === expected.join(), ids);
    check(
      "documents: void cheque is metadata only",
      r.body?.voidCheque?.fileName === "cheque.pdf" && r.body?.voidCheque?.mimeType === "application/pdf" && !r.text.includes("secret-cheque") && !/fileUrl/.test(JSON.stringify(r.body?.voidCheque)),
      r.body?.voidCheque,
    );
    const item = r.body?.items?.find((i: { id: string }) => i.id === dFile.id);
    check("documents: a file document says so, with its version", item?.hasFile === true && item?.version === "2" && item?.status === "PENDING", item);
    const owned = await call("GET", hostA, "/api/v1/documents", { cookie: owner });
    check("documents: an owner is 403", owned.status === 403, owned.body);
  }
  let textHash = "";
  {
    const r = await call("GET", hostA, `/api/v1/documents/${dText.id}`, { cookie });
    textHash = r.body?.contentSha256 ?? "";
    check("document: the text and its SHA-256", r.status === 200 && r.body?.content === CONTENT && textHash === sha256(CONTENT), r.body);
    const f = await call("GET", hostA, `/api/v1/documents/${dFile.id}`, { cookie });
    check(
      "document: a file off company storage is never passed on",
      f.status === 200 && f.body?.fileUrl === null && f.body?.hasFile === true && !f.text.includes("drive.google.com"),
      f.body,
    );
    check("document: its hash is of the link that version names", f.body?.contentSha256 === sha256(`file-ref\n${DRIVE}`), f.body?.contentSha256);
    const mateDoc = await call("GET", hostA, `/api/v1/documents/${dMate.id}`, { cookie });
    check("document: one assigned to someone else is 404", mateDoc.status === 404, mateDoc.body);
    const other = await call("GET", hostA, `/api/v1/documents/${dB.id}`, { cookie });
    check("document: another company's is 404", other.status === 404, other.body);
    const theirs = await call("GET", hostB, `/api/v1/documents/${dText.id}`, { cookie: bCleaner });
    check("document: from another company's host and session, 404", theirs.status === 404, theirs.body);
    const logs = await db.documentAccessLog.count({ where: { documentId: dText.id } });
    check("document: reading doesn't log an open by itself", logs === 0, logs);
  }
  {
    const r = await call("POST", hostA, `/api/v1/documents/${dText.id}/access`, { cookie, body: { action: "OPEN" } });
    const n = await db.documentAccessLog.count({ where: { documentId: dText.id, userId: cleaner, action: "OPEN" } });
    check("access: logged", r.status === 200 && r.body?.logged === true && n === 1, { body: r.body, n });
    const complete = await call("POST", hostA, `/api/v1/documents/${dText.id}/access`, { cookie, body: { action: "COMPLETE" } });
    check("access: COMPLETE from the app is 400", complete.status === 400, complete.body);
    const mateDoc = await call("POST", hostA, `/api/v1/documents/${dMate.id}/access`, { cookie, body: { action: "OPEN" } });
    check("access: a document not assigned to the caller is 404", mateDoc.status === 404, mateDoc.body);
  }

  // ── Documents: signing ────────────────────────────────────────────────────
  const sign = (documentId: string, body: Record<string, unknown>, who = cookie, headers: Record<string, string> = {}) =>
    post(`/api/v1/documents/${documentId}/sign`, who, {
      clientEventId: randomUUID(),
      agreed: true,
      version: "2",
      contentSha256: textHash,
      signature: SIGNATURE,
      ...body,
    }, { headers });
  {
    const stale = await sign(dText.id, { contentSha256: "0".repeat(64) });
    check("sign: a hash that isn't current is 409 DOCUMENT_CHANGED, not retryable", stale.status === 409 && stale.body?.error?.code === "DOCUMENT_CHANGED" && stale.body?.error?.retryable === false, stale.body);
    const oldVersion = await sign(dText.id, { version: "1" });
    check("sign: an old version is 409 DOCUMENT_CHANGED", oldVersion.status === 409 && oldVersion.body?.error?.code === "DOCUMENT_CHANGED", oldVersion.body);
    const notAgreed = await sign(dText.id, { agreed: false });
    check("sign: agreed must be true (400)", notAgreed.status === 400, notAgreed.body);
    const outside = await sign(dText.id, { signature: { ...SIGNATURE, strokes: [line(40, 120, 900, 90)] } });
    check("sign: a point outside the pad is 400", outside.status === 400, outside.body);
    const tap = await sign(dText.id, { signature: { ...SIGNATURE, strokes: [[[50, 50], [52, 51]]] } });
    check("sign: a tap is not a signature (400)", tap.status === 400, tap.body);
    const image = await sign(dText.id, { signature: "data:image/svg+xml;base64,PHN2Zy8+" });
    check("sign: an image from the phone is refused (400)", image.status === 400, image.body);
    const mateDoc = await sign(dMate.id, {});
    check("sign: a document not assigned to the caller is 404", mateDoc.status === 404, mateDoc.body);
    const byOwner = await sign(dText.id, {}, owner);
    check("sign: an owner is 403", byOwner.status === 403, byOwner.body);
    const still = await db.documentSignature.findFirst({ where: { documentId: dText.id, employeeId: cleaner } });
    check("sign: none of those signed anything", still?.status === "PENDING" && still.signatureUrl === null, still?.status);

    const id = randomUUID();
    const body = { clientEventId: id, agreed: true, version: "2", contentSha256: textHash, signature: SIGNATURE };
    const ua = "BookmopsPro/1.0 (iPhone; iOS 19.0) v1test";
    const ok = await post(`/api/v1/documents/${dText.id}/sign`, cookie, body, { headers: { "User-Agent": ua, "X-Forwarded-For": "203.0.113.7" } });
    check("sign: 200, the document as it now stands", ok.status === 200 && ok.body?.status === "SIGNED" && !!ok.body?.signedAt && ok.body?.contentSha256 === textHash, ok.body);
    const row = await db.documentSignature.findFirst({ where: { documentId: dText.id, employeeId: cleaner } });
    check(
      "sign: kept with it: version, hash, the server's consent sentence, User-Agent, IP",
      row?.signedVersion === "2" &&
        row.signedContentSha256 === textHash &&
        row.consentText === "I have read and agree to the terms set out in V1 Key policy, and I am signing this document electronically." &&
        row.userAgent === ua &&
        row.ipAddress === "203.0.113.7",
      row,
    );
    const url = row?.signatureUrl ?? "";
    let isServerPng = false;
    if (url.startsWith("data:image/png;base64,")) {
      const png = Buffer.from(url.slice("data:image/png;base64,".length), "base64");
      isServerPng = png.subarray(1, 4).toString("ascii") === "PNG" && png.readUInt32BE(16) === 600 && png.readUInt32BE(20) === 200;
    } else if (url.startsWith("https://res.cloudinary.com/")) {
      isServerPng = /\/signatures\//.test(url);
    }
    check("sign: the stored image is the server's own PNG of the strokes", isServerPng, url.slice(0, 80));
    const complete = await db.documentAccessLog.count({ where: { documentId: dText.id, userId: cleaner, action: "COMPLETE" } });
    check("sign: a COMPLETE access row", complete === 1, complete);
    const again = await post(`/api/v1/documents/${dText.id}/sign`, cookie, body, { headers: { "User-Agent": ua } });
    check("sign: a replay answers the stored result", again.status === 200 && again.headers["idempotent-replayed"] === "true" && again.body?.status === "SIGNED", again.body);
    const twice = await sign(dText.id, {});
    check("sign: signing again is 409 ALREADY_SIGNED", twice.status === 409 && twice.body?.error?.code === "ALREADY_SIGNED", twice.body);
    const revoked = await sign(dRevoked.id, { contentSha256: sha256("x") });
    check("sign: REVOKED is 409 NOT_SIGNABLE", revoked.status === 409 && revoked.body?.error?.code === "NOT_SIGNABLE", revoked.body);
    const expired = await sign(dExpired.id, { contentSha256: sha256("y") });
    check("sign: EXPIRED is 409 NOT_SIGNABLE", expired.status === 409 && expired.body?.error?.code === "NOT_SIGNABLE", expired.body);
  }
  {
    const before = await call("GET", hostA, `/api/v1/documents/${dChanging.id}`, { cookie });
    await db.document.update({ where: { id: dChanging.id }, data: { content: "Second wording, changed by the office." } });
    const r = await sign(dChanging.id, { contentSha256: before.body?.contentSha256 });
    check("sign: the office changed the text since it was loaded: 409 DOCUMENT_CHANGED", r.status === 409 && r.body?.error?.code === "DOCUMENT_CHANGED", r.body);
    const fresh = await call("GET", hostA, `/api/v1/documents/${dChanging.id}`, { cookie });
    const ok = await sign(dChanging.id, { contentSha256: fresh.body?.contentSha256 });
    check("sign: after a refetch, it signs", fresh.body?.contentSha256 !== before.body?.contentSha256 && ok.status === 200, ok.body);
  }

  // ── Strikes ───────────────────────────────────────────────────────────────
  {
    const r = await call("GET", hostA, "/api/v1/strikes", { cookie });
    const active = await db.cleanerStrike.count({ where: { cleanerId: cleaner, status: "ACTIVE", expiresAt: { gt: new Date() } } });
    const all = await db.cleanerStrike.count({ where: { cleanerId: cleaner } });
    const level = active >= 3 ? "REVIEW" : active >= 1 ? "WARNING" : "OK";
    check(
      "strikes: standing, with the web's rules",
      r.status === 200 && active >= 1 && r.body?.activeCount === active && r.body?.threshold === 3 && r.body?.windowDays === 30 && r.body?.level === level,
      { body: r.body?.activeCount, active, level: r.body?.level },
    );
    const items: { id: string; status: string; title: string; givenAt: string; job: { id: string; number: number } | null }[] = r.body?.items ?? [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const sorted = items.every((i, k) => k === 0 || items[k - 1]!.givenAt >= i.givenAt);
    check("strikes: only the caller's, newest first", items.length === all && sorted && byId.get(sActive.id)?.status === "ACTIVE" && byId.get(sExcused.id)?.status === "EXCUSED", items.map((i) => i.status));
    check("strikes: an active strike past its date is EXPIRED", byId.get(sRolled.id)?.status === "EXPIRED" && byId.get(sRolled.id)?.title === "No-show", byId.get(sRolled.id));
    const withJob = byId.get(sActive.id);
    check(
      "strikes: the job is its id and number only",
      withJob?.job?.id === F.jobs.mine && typeof withJob.job.number === "number" && Object.keys(withJob.job).sort().join() === "id,number" && items.every((i) => !i.job || Object.keys(i.job).sort().join() === "id,number"),
      withJob,
    );
    check(
      "strikes: never the admin's note, who gave or excused it, or the client",
      !r.text.includes("SECRET-ADMIN-NOTE") && !r.text.includes(F.users.owner.id) && !r.text.includes("Prem Sai") && !/adminNote|appliedBy|excusedBy|clientName/.test(r.text),
      r.text.slice(0, 300),
    );
    const owned = await call("GET", hostA, "/api/v1/strikes", { cookie: owner });
    check("strikes: an owner is 403", owned.status === 403, owned.body);
    const theirs = await call("GET", hostB, "/api/v1/strikes", { cookie: bCleaner });
    check("strikes: another company's cleaner sees none of these", theirs.status === 200 && theirs.body?.items?.length === 0 && theirs.body?.activeCount === 0, theirs.body);
  }
}
