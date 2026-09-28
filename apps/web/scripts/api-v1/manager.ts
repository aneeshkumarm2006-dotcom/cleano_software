/**
 * API v1 integration checks for the MANAGER side of Bookmops Pro
 * (packages/api/src/v1/manager-*.ts): the team's day and crews, approvals
 * (time, withdrawals, kit), alerts, late arrivals, problems, the office inbox
 * and team-chat moderation.
 *
 * Run by scripts/api-v1-integration.ts against its two throwaway companies,
 * or on its own against a running server connected to STAGING:
 *
 *   V1_PORT=3188 V1_FIXTURE_SUFFIX=mgr FIXTURE_DATABASE_URL="$STAGING_DIRECT_URL" \
 *     npx tsx scripts/api-v1/manager.ts
 *
 * Everything it creates lives in company A or B (synthetic people, "Prem Sai"
 * jobs) and goes when they do. For each endpoint: every role's happy path,
 * EMPLOYEE 403, another company's id 404, a field lead outside their group
 * 404, self-approval 403, two decisions at once (exactly one wins),
 * idempotent replay, and the stale-crew / stale-warnings 409s.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

import type { PrismaClient, Roles } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { crewWarningsHash } from "@bookmops/api/v1";
import { createFixture, openDb, PASSWORD, removeFixture, SLUG_A, SLUG_B, type Fixture } from "./fixture";

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

export interface ManagerHarness {
  db: PrismaClient;
  F: Fixture;
  HOST_A: string;
  HOST_B: string;
  call: (
    method: string,
    host: string,
    path: string,
    opts?: { cookie?: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<Res>;
  check: (name: string, ok: boolean, detail?: unknown) => void;
  signIn: (host: string, email: string) => Promise<string>;
}

const M = "/api/v1/manager";
const HOUR = 3600_000;

export async function managerChecks(t: ManagerHarness): Promise<void> {
  const { db, F, HOST_A, call, check, signIn } = t;
  const A = F.orgA.id;
  const B = F.orgB.id;
  const tag = randomUUID().slice(0, 6);
  const hashed = await hashPassword(PASSWORD);

  async function person(org: string, slug: string, local: string, role: Roles, extra: { fieldLeadId?: string } = {}) {
    const email = `${local}-${tag}@${slug}.test`;
    const u = await db.user.create({
      data: {
        organizationId: org,
        name: `${local[0].toUpperCase()}${local.slice(1)} Mgr`,
        email,
        role,
        emailVerified: true,
        isActive: true,
        ...(extra.fieldLeadId ? { fieldLeadId: extra.fieldLeadId } : {}),
      },
      select: { id: true, email: true, name: true },
    });
    await db.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: hashed } });
    return u;
  }

  const admin2 = await person(A, F.orgA.slug, "admintwo", "ADMIN");
  const ops = await person(A, F.orgA.slug, "ops", "OPS_MANAGER");
  const lead = await person(A, F.orgA.slug, "lead", "FIELD_LEAD");
  const grp = await person(A, F.orgA.slug, "grp", "EMPLOYEE", { fieldLeadId: lead.id });
  const outsider = await person(A, F.orgA.slug, "outsider", "EMPLOYEE");
  const bOwner = await person(B, F.orgB.slug, "bowner", "OWNER");

  const owner = await signIn(HOST_A, F.users.owner.email);
  const admin2C = await signIn(HOST_A, admin2.email);
  const opsC = await signIn(HOST_A, ops.email);
  const leadC = await signIn(HOST_A, lead.email);
  const grpC = await signIn(HOST_A, grp.email);
  const cleanerC = await signIn(HOST_A, F.users.cleaner.email);

  const get = (path: string, cookie: string) => call("GET", HOST_A, path, { cookie });
  const post = (path: string, cookie: string, body: Record<string, unknown>, key?: string) =>
    call("POST", HOST_A, path, {
      cookie,
      body,
      headers: key === "" ? {} : { "Idempotency-Key": key ?? String(body.clientEventId ?? randomUUID()) },
    });
  const put = (path: string, cookie: string, body: Record<string, unknown>) =>
    call("PUT", HOST_A, path, { cookie, body, headers: { "Idempotency-Key": String(body.clientEventId) } });
  const del = (path: string, cookie: string) =>
    call("DELETE", HOST_A, path, { cookie, headers: { "Content-Type": "application/json" } });
  const code = (r: Res) => r.body?.error?.code;
  const ids = (r: Res): string[] => (r.body?.items ?? []).map((i: { id: string }) => i.id);

  let n = 9500 + Math.floor(Math.random() * 400);
  async function job(org: string, cleanerId: string, startMs: number, label: string, extra: Record<string, unknown> = {}) {
    const start = new Date(startMs);
    const j = await db.job.create({
      data: {
        organizationId: org,
        jobNumber: n++,
        clientName: `Prem Sai Mgr${label}`,
        employeeId: cleanerId,
        jobType: "Standard Clean",
        location: `${n} Test Street, Testville, ON`,
        startTime: start,
        endTime: new Date(start.getTime() + 3 * HOUR),
        jobDate: start,
        status: "SCHEDULED",
        price: 120,
        subtotalAmount: 120,
        requiredCleaners: 1,
        cleaners: { connect: [{ id: cleanerId }] },
        ...extra,
      },
      select: { id: true, jobNumber: true },
    });
    await db.jobAssignment.create({ data: { organizationId: org, jobId: j.id, cleanerId } });
    return j;
  }
  async function session(org: string, jobId: string, cleanerId: string, startedAt: Date, endedAt: Date | null) {
    return db.jobWorkSession.create({
      data: { organizationId: org, jobId, cleanerId, startedAt, endedAt },
      select: { id: true },
    });
  }
  async function timeRequest(
    org: string,
    jobId: string,
    cleanerId: string,
    sessionId: string,
    requestedStart: Date,
    extra: Record<string, unknown> = {},
  ) {
    return db.timeLogChangeRequest.create({
      data: { organizationId: org, jobId, cleanerId, sessionId, requestedStart, reason: "Forgot to clock in", ...extra },
      select: { id: true },
    });
  }

  const now = Date.now();
  // Today's jobs, for the team's day: one in the lead's group, one outside it.
  // A minute from now, so they are on the company's today (America/Toronto)
  // whatever the hour the run starts.
  const jobG = await job(A, grp.id, now + 60_000, "G");
  const jobO = await job(A, outsider.id, now + 60_000, "O");
  const jobB = await job(B, F.users.bCleaner.id, now + 60_000, "B");

  // ── The team's day and one job ─────────────────────────────────────────
  {
    const o = await get(`${M}/team/day`, owner);
    const oJobs = (o.body?.jobs ?? []).map((j: { id: string }) => j.id);
    check("mgr team day: OWNER sees the company's day", o.status === 200 && oJobs.includes(jobG.id) && oJobs.includes(jobO.id), o.body);
    const l = await get(`${M}/team/day`, leadC);
    const lJobs = (l.body?.jobs ?? []).map((j: { id: string }) => j.id);
    check("mgr team day: FIELD_LEAD sees their group only", l.status === 200 && lJobs.includes(jobG.id) && !lJobs.includes(jobO.id), l.body);
    const op = await get(`${M}/team/day`, opsC);
    check("mgr team day: OPS_MANAGER sees the company today", op.status === 200 && (op.body?.jobs ?? []).some((j: { id: string }) => j.id === jobO.id), op.body);
    const e = await get(`${M}/team/day`, cleanerC);
    check("mgr team day: EMPLOYEE 403", e.status === 403, e.body);
    const lo = await get(`${M}/jobs/${jobO.id}`, leadC);
    check("mgr job: field lead outside their group 404", lo.status === 404, lo.body);
    const ob = await get(`${M}/jobs/${jobB.id}`, owner);
    check("mgr job: another company's job 404", ob.status === 404, ob.body);
    const og = await get(`${M}/jobs/${jobG.id}`, owner);
    check("mgr job: OWNER opens one", og.status === 200 && og.body?.id === jobG.id, og.body);
  }

  // ── Crew changes ───────────────────────────────────────────────────────
  {
    const cand = await get(`${M}/jobs/${jobG.id}/candidates`, owner);
    check("mgr candidates: OWNER 200", cand.status === 200 && Array.isArray(cand.body?.candidates), cand.body);
    const warnFor = (id: string) =>
      (cand.body?.candidates ?? [])
        .filter((c: { id: string }) => c.id === id)
        .flatMap((c: { warnings: { code: string }[] }) => c.warnings.map((w) => ({ cleanerId: id, code: w.code })));
    const hashAdd = crewWarningsHash(warnFor(outsider.id));
    const e = await get(`${M}/jobs/${jobG.id}/candidates`, cleanerC);
    check("mgr candidates: EMPLOYEE 403", e.status === 403, e.body);

    const stale = { cleanerIds: [grp.id, outsider.id], expectedCrewIds: [], acknowledgedWarningsHash: hashAdd, clientEventId: randomUUID() };
    const s = await put(`${M}/jobs/${jobG.id}/crew`, owner, stale);
    check("mgr crew: stale expectedCrewIds 409 CREW_CHANGED", s.status === 409 && code(s) === "CREW_CHANGED", s.body);
    const badHash = { cleanerIds: [grp.id, outsider.id], expectedCrewIds: [grp.id], acknowledgedWarningsHash: "w1-stale", clientEventId: randomUUID() };
    const h = await put(`${M}/jobs/${jobG.id}/crew`, owner, badHash);
    check("mgr crew: stale warnings hash 409 WARNINGS_CHANGED", h.status === 409 && code(h) === "WARNINGS_CHANGED", h.body);
    const good = { cleanerIds: [grp.id, outsider.id], expectedCrewIds: [grp.id], acknowledgedWarningsHash: hashAdd, clientEventId: randomUUID() };
    const g = await put(`${M}/jobs/${jobG.id}/crew`, owner, good);
    check("mgr crew: OWNER sets the crew", g.status === 200, g.body);
    const again = await put(`${M}/jobs/${jobG.id}/crew`, owner, good);
    check("mgr crew: replay answers the stored response", again.status === 200 && again.headers["idempotent-replayed"] === "true", again.headers);
    const opsPut = await put(`${M}/jobs/${jobG.id}/crew`, opsC, { ...good, clientEventId: randomUUID() });
    check("mgr crew: OPS_MANAGER can't set a crew (403)", opsPut.status === 403, opsPut.body);
    const bPut = await put(`${M}/jobs/${jobB.id}/crew`, owner, { ...good, clientEventId: randomUUID() });
    check("mgr crew: another company's job 404", bPut.status === 404, bPut.body);
    // Put the crew back for the checks below.
    const back = await put(`${M}/jobs/${jobG.id}/crew`, owner, {
      cleanerIds: [grp.id],
      expectedCrewIds: [grp.id, outsider.id],
      acknowledgedWarningsHash: crewWarningsHash([]),
      clientEventId: randomUUID(),
    });
    check("mgr crew: taking someone off", back.status === 200, back.body);
  }

  // ── Approvals: time ────────────────────────────────────────────────────
  const past = now - 10 * 24 * HOUR;
  const jobT = await job(A, grp.id, past, "T");
  const jobTO = await job(A, outsider.id, past, "TO");
  const jobTOwn = await job(A, F.users.owner.id, past, "TOwn");
  const jobTLead = await job(A, lead.id, past, "TLead");
  const jobTB = await job(B, F.users.bCleaner.id, past, "TB");
  const lockedDay = now - 40 * 24 * HOUR;
  const jobLocked = await job(A, grp.id, lockedDay, "L");

  const at = (base: number, min: number) => new Date(base + min * 60_000);
  const sG1 = await session(A, jobT.id, grp.id, at(past, 20), at(past, 180));
  const sO = await session(A, jobTO.id, outsider.id, at(past, 20), at(past, 180));
  const sOwn = await session(A, jobTOwn.id, F.users.owner.id, at(past, 20), at(past, 180));
  const sLead = await session(A, jobTLead.id, lead.id, at(past, 20), at(past, 180));
  const sB = await session(B, jobTB.id, F.users.bCleaner.id, at(past, 20), at(past, 180));
  const sL = await session(A, jobLocked.id, grp.id, at(lockedDay, 20), at(lockedDay, 180));

  // Separate jobs for each decision on a group session, so one edit can't move another's.
  const jobT2 = await job(A, grp.id, past + HOUR * 4, "T2");
  const jobT3 = await job(A, grp.id, past + HOUR * 8, "T3");
  const jobT4 = await job(A, grp.id, past + HOUR * 12, "T4");
  const sG2 = await session(A, jobT2.id, grp.id, at(past + 4 * HOUR, 20), at(past + 4 * HOUR, 180));
  const sG3 = await session(A, jobT3.id, grp.id, at(past + 8 * HOUR, 20), at(past + 8 * HOUR, 180));
  const sG4 = await session(A, jobT4.id, grp.id, at(past + 12 * HOUR, 20), at(past + 12 * HOUR, 180));

  const rG1 = await timeRequest(A, jobT.id, grp.id, sG1.id, at(past, 0));
  const rG2 = await timeRequest(A, jobT2.id, grp.id, sG2.id, at(past + 4 * HOUR, 0));
  const rG3 = await timeRequest(A, jobT3.id, grp.id, sG3.id, at(past + 8 * HOUR, 0));
  const rOff = await timeRequest(A, jobT4.id, grp.id, sG4.id, at(past + 12 * HOUR, 5), {
    source: "OFFLINE_CLOCK",
    eventKind: "CLOCK_IN",
    offlineReason: "GAP_OVER_LIMIT",
    occurredAt: at(past + 12 * HOUR, 5),
    receivedAt: at(past + 12 * HOUR, 20),
    clientEventId: randomUUID(),
  });
  const rO = await timeRequest(A, jobTO.id, outsider.id, sO.id, at(past, 0));
  const rOwn = await timeRequest(A, jobTOwn.id, F.users.owner.id, sOwn.id, at(past, 0));
  const rLead = await timeRequest(A, jobTLead.id, lead.id, sLead.id, at(past, 0));
  const rB = await timeRequest(B, jobTB.id, F.users.bCleaner.id, sB.id, at(past, 0));
  const rL = await timeRequest(A, jobLocked.id, grp.id, sL.id, at(lockedDay, 0));
  await db.payPeriod.create({
    data: {
      organizationId: A,
      startDate: new Date(lockedDay - 2 * 24 * HOUR),
      endDate: new Date(lockedDay + 2 * 24 * HOUR),
      status: "APPROVED",
    },
  });

  {
    const o = await get(`${M}/approvals/time?status=pending`, owner);
    const oi = ids(o);
    check(
      "mgr time list: OWNER sees the company's pending, never their own",
      o.status === 200 && oi.includes(rG1.id) && oi.includes(rO.id) && oi.includes(rLead.id) && !oi.includes(rOwn.id) && !oi.includes(rB.id),
      oi,
    );
    const l = await get(`${M}/approvals/time?status=pending`, leadC);
    const li = ids(l);
    check(
      "mgr time list: FIELD_LEAD sees their group only, never their own",
      l.status === 200 && li.includes(rG1.id) && !li.includes(rO.id) && !li.includes(rLead.id),
      li,
    );
    const lItem = (l.body?.items ?? []).find((i: { id: string }) => i.id === rG1.id);
    check("mgr time list: a lead sees the client's first name only", lItem?.job?.clientName === "Prem", lItem?.job);
    const off = (o.body?.items ?? []).find((i: { id: string }) => i.id === rOff.id);
    check("mgr time list: an offline item carries its event", off?.kind === "OFFLINE_CLOCK" && off?.offline?.why === "GAP_OVER_LIMIT" && off?.reason === null, off);
    const opsL = await get(`${M}/approvals/time?status=pending`, opsC);
    check("mgr time list: OPS_MANAGER is company-wide", opsL.status === 200 && ids(opsL).includes(rO.id), ids(opsL));
    const e = await get(`${M}/approvals/time`, cleanerC);
    check("mgr time list: EMPLOYEE 403", e.status === 403, e.body);
    const bad = await get(`${M}/approvals/time?cursor=not-a-cursor!`, owner);
    check("mgr time list: a bad cursor 400", bad.status === 400, bad.body);

    const s = await get(`${M}/approvals/summary`, owner);
    const ownCount = await db.timeLogChangeRequest.count({ where: { organizationId: A, status: "PENDING", cleanerId: { not: F.users.owner.id } } });
    check("mgr summary: OWNER counts every queue, less their own", s.status === 200 && s.body?.time === ownCount && typeof s.body?.withdrawals === "number" && typeof s.body?.kit === "number", { body: s.body, ownCount });
    const sl = await get(`${M}/approvals/summary`, leadC);
    check("mgr summary: FIELD_LEAD gets null for queues they can't act on", sl.status === 200 && sl.body?.withdrawals === null && sl.body?.kit === null && typeof sl.body?.time === "number", sl.body);
    const se = await get(`${M}/approvals/summary`, cleanerC);
    check("mgr summary: EMPLOYEE 403", se.status === 403, se.body);

    const lo = await get(`${M}/approvals/time/${rO.id}`, leadC);
    check("mgr time item: field lead outside their group 404", lo.status === 404, lo.body);
    const self = await get(`${M}/approvals/time/${rOwn.id}`, owner);
    check("mgr time item: the caller's own 403 SELF_APPROVAL", self.status === 403 && code(self) === "SELF_APPROVAL", self.body);
    const ob = await get(`${M}/approvals/time/${rB.id}`, owner);
    check("mgr time item: another company's 404", ob.status === 404, ob.body);

    const selfDecide = await post(`${M}/approvals/time/${rLead.id}/decision`, leadC, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: a lead deciding their own 403 SELF_APPROVAL", selfDecide.status === 403 && code(selfDecide) === "SELF_APPROVAL", selfDecide.body);
    const ownerSelf = await post(`${M}/approvals/time/${rOwn.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: OWNER deciding their own 403 SELF_APPROVAL", ownerSelf.status === 403 && code(ownerSelf) === "SELF_APPROVAL", ownerSelf.body);
    const leadAdjust = await post(`${M}/approvals/time/${rG1.id}/decision`, leadC, {
      decision: "ADJUST",
      start: at(past, 10).toISOString(),
      end: at(past, 170).toISOString(),
      note: "Close enough",
      clientEventId: randomUUID(),
    });
    check("mgr time decide: FIELD_LEAD can't ADJUST (403)", leadAdjust.status === 403 && code(leadAdjust) === "FORBIDDEN", leadAdjust.body);
    const outside = await post(`${M}/approvals/time/${rO.id}/decision`, leadC, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: field lead outside their group 404", outside.status === 404, outside.body);
    const noNote = await post(`${M}/approvals/time/${rG1.id}/decision`, owner, { decision: "REJECT", clientEventId: randomUUID() });
    check("mgr time decide: REJECT without a note 400 NOTE_REQUIRED", noNote.status === 400 && code(noNote) === "NOTE_REQUIRED", noNote.body);
    const eDecide = await post(`${M}/approvals/time/${rG1.id}/decision`, cleanerC, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: EMPLOYEE 403", eDecide.status === 403, eDecide.body);
    const bDecide = await post(`${M}/approvals/time/${rB.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: another company's 404", bDecide.status === 404, bDecide.body);

    // A lead approves their group's request: the session moves to what was asked.
    const approveBody = { decision: "APPROVE", note: "Saw them arrive", clientEventId: randomUUID() };
    const ap = await post(`${M}/approvals/time/${rG1.id}/decision`, leadC, approveBody);
    const moved = await db.jobWorkSession.findUnique({ where: { id: sG1.id } });
    check(
      "mgr time decide: FIELD_LEAD approves their group's request; the session moves",
      ap.status === 200 && ap.body?.status === "APPROVED" && moved?.startedAt.getTime() === at(past, 0).getTime() && moved?.endedAt?.getTime() === at(past, 180).getTime(),
      { body: ap.body, moved },
    );
    const logs1 = await db.activityLog.count({ where: { organizationId: A, action: "timelog.request.approved", targetId: jobT.id } });
    const replay = await post(`${M}/approvals/time/${rG1.id}/decision`, leadC, approveBody);
    const logs2 = await db.activityLog.count({ where: { organizationId: A, action: "timelog.request.approved", targetId: jobT.id } });
    check("mgr time decide: replay answers the stored response and logs nothing more", replay.status === 200 && replay.headers["idempotent-replayed"] === "true" && logs1 === 1 && logs2 === 1, { logs1, logs2 });
    const reuse = await post(`${M}/approvals/time/${rG1.id}/decision`, leadC, { ...approveBody, note: "different" });
    check("mgr time decide: the same key with another body 422", reuse.status === 422, reuse.body);
    const twice = await post(`${M}/approvals/time/${rG1.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr time decide: deciding a decided item 409 ALREADY_DECIDED", twice.status === 409 && code(twice) === "ALREADY_DECIDED", twice.body);

    // ADJUST: a null end over a clock-out on record is refused; given times apply.
    const nullEnd = await post(`${M}/approvals/time/${rG2.id}/decision`, owner, {
      decision: "ADJUST",
      start: at(past + 4 * HOUR, 10).toISOString(),
      end: null,
      note: "Fixing",
      clientEventId: randomUUID(),
    });
    check("mgr time decide: ADJUST with a null end over a clock-out 400", nullEnd.status === 400, nullEnd.body);
    const stillPending = await db.timeLogChangeRequest.findUnique({ where: { id: rG2.id }, select: { status: true } });
    check("mgr time decide: ...and the item stays pending", stillPending?.status === "PENDING", stillPending);
    const adj = await post(`${M}/approvals/time/${rG2.id}/decision`, owner, {
      decision: "ADJUST",
      start: at(past + 4 * HOUR, 10).toISOString(),
      end: at(past + 4 * HOUR, 170).toISOString(),
      note: "Checked the door log",
      clientEventId: randomUUID(),
    });
    const adjS = await db.jobWorkSession.findUnique({ where: { id: sG2.id } });
    check(
      "mgr time decide: OWNER ADJUSTs to times nobody asked for",
      adj.status === 200 && adj.body?.status === "APPROVED" && adj.body?.decided?.note === "Checked the door log" &&
        adjS?.startedAt.getTime() === at(past + 4 * HOUR, 10).getTime() && adjS?.endedAt?.getTime() === at(past + 4 * HOUR, 170).getTime(),
      { body: adj.body, adjS },
    );

    // Two managers at once: exactly one decision lands, and the times move once.
    const [c1, c2] = await Promise.all([
      post(`${M}/approvals/time/${rG3.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() }),
      post(`${M}/approvals/time/${rG3.id}/decision`, admin2C, { decision: "REJECT", note: "No", clientEventId: randomUUID() }),
    ]);
    const statuses = [c1.status, c2.status].sort();
    const loser = c1.status === 409 ? c1 : c2;
    const row3 = await db.timeLogChangeRequest.findUnique({ where: { id: rG3.id } });
    check(
      "mgr time decide: two at once, exactly one wins (409 ALREADY_DECIDED for the other)",
      statuses[0] === 200 && statuses[1] === 409 && code(loser) === "ALREADY_DECIDED" && row3?.status !== "PENDING",
      { s: [c1.status, c2.status], b: [c1.body, c2.body] },
    );

    // Locked pay period: refused, nothing applied, the item still waiting.
    const locked = await post(`${M}/approvals/time/${rL.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    const lockedRow = await db.timeLogChangeRequest.findUnique({ where: { id: rL.id } });
    const lockedS = await db.jobWorkSession.findUnique({ where: { id: sL.id } });
    check(
      "mgr time decide: under a locked pay period 409 PAY_PERIOD_LOCKED, still pending, nothing moved",
      locked.status === 409 && code(locked) === "PAY_PERIOD_LOCKED" && lockedRow?.status === "PENDING" && lockedS?.startedAt.getTime() === at(lockedDay, 20).getTime(),
      { body: locked.body, lockedRow: lockedRow?.status },
    );

    // An offline item approved: the phone's claimed time applies; pendingReview clears.
    const offA = await post(`${M}/approvals/time/${rOff.id}/decision`, opsC, { decision: "APPROVE", clientEventId: randomUUID() });
    const offS = await db.jobWorkSession.findUnique({ where: { id: sG4.id } });
    const pendingOff = await db.timeLogChangeRequest.count({ where: { jobId: jobT4.id, cleanerId: grp.id, source: "OFFLINE_CLOCK", status: "PENDING" } });
    check(
      "mgr time decide: OPS_MANAGER approves an offline item; its time applies and nothing is left pending",
      offA.status === 200 && offS?.startedAt.getTime() === at(past + 12 * HOUR, 5).getTime() && pendingOff === 0,
      { body: offA.body, offS },
    );

    const d = await get(`${M}/approvals/time?status=decided`, owner);
    const di = ids(d);
    check("mgr time list: decided, newest first", d.status === 200 && di[0] === rOff.id && di.includes(rG1.id), di);
  }

  // ── Approvals: withdrawals ─────────────────────────────────────────────
  const wd = (org: string, employeeId: string, amount: number, status: "PENDING" | "APPROVED" = "PENDING") =>
    db.withdrawal.create({ data: { organizationId: org, employeeId, amount, status }, select: { id: true } });
  const w1 = await wd(A, grp.id, 50);
  const w2 = await wd(A, outsider.id, 20.5);
  const w3 = await wd(A, F.users.owner.id, 30);
  const w4 = await wd(B, F.users.bCleaner.id, 10);
  {
    const o = await get(`${M}/withdrawals?status=open`, owner);
    const oi = ids(o);
    const openSum = await db.withdrawal.findMany({
      where: { organizationId: A, status: { in: ["PENDING", "APPROVED"] }, employeeId: { not: F.users.owner.id } },
      select: { amount: true },
    });
    const expected = openSum.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    check(
      "mgr withdrawals: OWNER's open queue, never their own, with the open total",
      o.status === 200 && oi.includes(w1.id) && oi.includes(w2.id) && !oi.includes(w3.id) && !oi.includes(w4.id) && o.body?.openTotalCents === expected,
      { oi, total: o.body?.openTotalCents, expected },
    );
    for (const [who, c] of [["OPS_MANAGER", opsC], ["FIELD_LEAD", leadC], ["EMPLOYEE", cleanerC]] as const) {
      const r = await get(`${M}/withdrawals`, c);
      check(`mgr withdrawals: ${who} 403`, r.status === 403, r.body);
    }
    const self = await get(`${M}/withdrawals/${w3.id}`, owner);
    check("mgr withdrawal: the caller's own 403 SELF_APPROVAL", self.status === 403 && code(self) === "SELF_APPROVAL", self.body);
    const other = await get(`${M}/withdrawals/${w4.id}`, owner);
    check("mgr withdrawal: another company's 404", other.status === 404, other.body);
    const selfD = await post(`${M}/withdrawals/${w3.id}/decision`, owner, { action: "APPROVE", paymentMethod: "E_TRANSFER", clientEventId: randomUUID() });
    check("mgr withdrawal decide: the caller's own 403 SELF_APPROVAL", selfD.status === 403 && code(selfD) === "SELF_APPROVAL", selfD.body);
    const noMethod = await post(`${M}/withdrawals/${w1.id}/decision`, owner, { action: "APPROVE", paymentMethod: null, clientEventId: randomUUID() });
    check("mgr withdrawal decide: APPROVE without a method 400", noMethod.status === 400, noMethod.body);
    const rejMethod = await post(`${M}/withdrawals/${w1.id}/decision`, owner, { action: "REJECT", paymentMethod: "CASH", clientEventId: randomUUID() });
    check("mgr withdrawal decide: REJECT with a method 400", rejMethod.status === 400, rejMethod.body);
    const opsD = await post(`${M}/withdrawals/${w1.id}/decision`, opsC, { action: "APPROVE", paymentMethod: "CASH", clientEventId: randomUUID() });
    check("mgr withdrawal decide: OPS_MANAGER 403", opsD.status === 403, opsD.body);
    const bD = await post(`${M}/withdrawals/${w4.id}/decision`, owner, { action: "APPROVE", paymentMethod: "CASH", clientEventId: randomUUID() });
    check("mgr withdrawal decide: another company's 404", bD.status === 404, bD.body);

    const ap = await post(`${M}/withdrawals/${w1.id}/decision`, owner, { action: "APPROVE", paymentMethod: "E_TRANSFER", clientEventId: randomUUID() });
    const w1a = await db.withdrawal.findUnique({ where: { id: w1.id } });
    check(
      "mgr withdrawal decide: OWNER approves; who did it is recorded; the amount is untouched",
      ap.status === 200 && ap.body?.status === "APPROVED" && w1a?.processedById === F.users.owner.id && w1a?.amount === 50 && ap.body?.amountCents === 5000,
      { body: ap.body, w1a },
    );
    const payBody = { action: "COMPLETE", paymentMethod: "E_TRANSFER", clientEventId: randomUUID() };
    const paid = await post(`${M}/withdrawals/${w1.id}/decision`, admin2C, payBody);
    const replay = await post(`${M}/withdrawals/${w1.id}/decision`, admin2C, payBody);
    check("mgr withdrawal decide: ADMIN marks it paid", paid.status === 200 && paid.body?.status === "COMPLETED" && !!paid.body?.processedAt, paid.body);
    check("mgr withdrawal decide: replay answers the stored response", replay.status === 200 && replay.headers["idempotent-replayed"] === "true", replay.headers);
    const late = await post(`${M}/withdrawals/${w1.id}/decision`, owner, { action: "APPROVE", paymentMethod: "CASH", clientEventId: randomUUID() });
    check("mgr withdrawal decide: a completed one 409 WITHDRAWAL_STATE", late.status === 409 && code(late) === "WITHDRAWAL_STATE", late.body);

    const [a, b] = await Promise.all([
      post(`${M}/withdrawals/${w2.id}/decision`, owner, { action: "COMPLETE", paymentMethod: "CASH", clientEventId: randomUUID() }),
      post(`${M}/withdrawals/${w2.id}/decision`, admin2C, { action: "REJECT", paymentMethod: null, clientEventId: randomUUID() }),
    ]);
    const s = [a.status, b.status].sort();
    const loser = a.status === 409 ? a : b;
    check(
      "mgr withdrawal decide: COMPLETE and REJECT at once, exactly one wins",
      s[0] === 200 && s[1] === 409 && code(loser) === "WITHDRAWAL_STATE",
      { s: [a.status, b.status], b: [a.body, b.body] },
    );
  }

  // ── Approvals: kit restocks ────────────────────────────────────────────
  const product = await db.product.create({
    data: { organizationId: A, name: `Mgr Spray ${tag}`, unit: "bottles", costPerUnit: 2, stockLevel: 10 },
    select: { id: true },
  });
  const loc = await db.inventoryLocation.create({ data: { organizationId: A, name: `Mgr Shelf ${tag}` }, select: { id: true } });
  await db.inventoryLocationStock.create({ data: { organizationId: A, locationId: loc.id, productId: product.id, quantity: 10 } });
  const kr = (org: string, employeeId: string, productId: string | null, quantity: number) =>
    db.inventoryRequest.create({ data: { organizationId: org, employeeId, productId, quantity, reason: "Running low" }, select: { id: true } });
  const k1 = await kr(A, grp.id, product.id, 3);
  const kShort = await kr(A, outsider.id, product.id, 50);
  const kOwn = await kr(A, F.users.owner.id, product.id, 1);
  const kRace = await kr(A, outsider.id, product.id, 2);
  const bProduct = await db.product.create({ data: { organizationId: B, name: "B Spray", unit: "bottles", costPerUnit: 2, stockLevel: 5 }, select: { id: true } });
  const kB = await kr(B, F.users.bCleaner.id, bProduct.id, 1);
  {
    const l = await get(`${M}/kit-requests`, owner);
    const li = ids(l);
    check("mgr kit: OWNER's queue, never their own", l.status === 200 && li.includes(k1.id) && !li.includes(kOwn.id) && !li.includes(kB.id), li);
    for (const [who, c] of [["OPS_MANAGER", opsC], ["FIELD_LEAD", leadC], ["EMPLOYEE", cleanerC]] as const) {
      const r = await get(`${M}/kit-requests`, c);
      check(`mgr kit: ${who} 403`, r.status === 403, r.body);
    }
    const self = await post(`${M}/kit-requests/${kOwn.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr kit decide: the caller's own 403 SELF_APPROVAL", self.status === 403 && code(self) === "SELF_APPROVAL", self.body);
    const bD = await post(`${M}/kit-requests/${kB.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    check("mgr kit decide: another company's 404", bD.status === 404, bD.body);

    const body = { decision: "APPROVE", clientEventId: randomUUID() };
    const ap = await post(`${M}/kit-requests/${k1.id}/decision`, owner, body);
    const replay = await post(`${M}/kit-requests/${k1.id}/decision`, owner, body);
    const stock = await db.product.findUnique({ where: { id: product.id }, select: { stockLevel: true } });
    const kit = await db.employeeProduct.findFirst({ where: { employeeId: grp.id, productId: product.id } });
    const audits = await db.inventoryChange.count({ where: { productId: product.id, action: "REQUEST_FULFILLED" } });
    check("mgr kit decide: OWNER approves; FULFILLED", ap.status === 200 && ap.body?.status === "FULFILLED", ap.body);
    check(
      "mgr kit decide: replayed, the stock moved once, with both audit rows",
      replay.headers["idempotent-replayed"] === "true" && stock?.stockLevel === 7 && kit?.quantity === 3 && audits === 2,
      { stock, kit: kit?.quantity, audits },
    );
    const short = await post(`${M}/kit-requests/${kShort.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() });
    const shortRow = await db.inventoryRequest.findUnique({ where: { id: kShort.id }, select: { status: true } });
    check("mgr kit decide: a short warehouse 409 WAREHOUSE_SHORT, still pending", short.status === 409 && code(short) === "WAREHOUSE_SHORT" && shortRow?.status === "PENDING", short.body);
    const rej = await post(`${M}/kit-requests/${kShort.id}/decision`, admin2C, { decision: "REJECT", clientEventId: randomUUID() });
    check("mgr kit decide: ADMIN rejects", rej.status === 200 && rej.body?.status === "REJECTED", rej.body);

    const [a, b] = await Promise.all([
      post(`${M}/kit-requests/${kRace.id}/decision`, owner, { decision: "APPROVE", clientEventId: randomUUID() }),
      post(`${M}/kit-requests/${kRace.id}/decision`, admin2C, { decision: "APPROVE", clientEventId: randomUUID() }),
    ]);
    const after = await db.product.findUnique({ where: { id: product.id }, select: { stockLevel: true } });
    const s = [a.status, b.status].sort();
    const loser = a.status === 409 ? a : b;
    check(
      "mgr kit decide: two approvals at once, one wins and the stock moves once",
      s[0] === 200 && s[1] === 409 && code(loser) === "ALREADY_RESOLVED" && after?.stockLevel === 5,
      { s: [a.status, b.status], stock: after, b: [a.body, b.body] },
    );
  }

  // ── Alerts ─────────────────────────────────────────────────────────────
  const note = (org: string, key: string, href: string | null, title: string) =>
    db.notification.create({ data: { organizationId: org, notificationKey: key, title, body: "Prem Sai Fullname needs cover", href, severity: "WARN" }, select: { id: true } });
  const nG = await note(A, "admin.shift.dropped_urgent", `/admin/jobs/${jobG.id}`, "Cover needed for Prem Sai MgrG");
  const nO = await note(A, "admin.shift.dropped_urgent", `/admin/jobs/${jobO.id}`, "Cover needed for Prem Sai MgrO");
  const nIssue = await note(A, "admin.job.issue_reported", `/admin/jobs/${jobG.id}`, "Issue on Prem Sai MgrG");
  const nNoJob = await note(A, "admin.shift.dropped", null, "A shift was dropped");
  const nB = await note(B, "admin.shift.dropped_urgent", `/admin/jobs/${jobB.id}`, "B cover");
  {
    const o = await get(`${M}/alerts`, owner);
    const oi = ids(o);
    check(
      "mgr alerts: OWNER reads the company's feed",
      o.status === 200 && [nG, nO, nIssue, nNoJob].every((x) => oi.includes(x.id)) && !oi.includes(nB.id) && o.body?.unreadCount >= 4,
      { oi, unread: o.body?.unreadCount },
    );
    const og = (o.body?.items ?? []).find((i: { id: string }) => i.id === nG.id);
    check("mgr alerts: kinds are mapped and the job is named", og?.kind === "COVER_NEEDED" && og?.jobId === jobG.id && og?.title.includes("Prem Sai"), og);
    const l = await get(`${M}/alerts`, leadC);
    const li = ids(l);
    const lg = (l.body?.items ?? []).find((i: { id: string }) => i.id === nG.id);
    check(
      "mgr alerts: FIELD_LEAD gets their group's lead kinds only",
      l.status === 200 && li.includes(nG.id) && !li.includes(nO.id) && !li.includes(nIssue.id) && !li.includes(nNoJob.id) && !li.includes(nB.id),
      li,
    );
    check(
      "mgr alerts: a lead's title is built from the kind and job number, no body",
      lg?.title === `Cover needed · job #${jobG.jobNumber}` && lg?.body === null && l.body?.unreadCount === 1,
      { lg, unread: l.body?.unreadCount },
    );
    const e = await get(`${M}/alerts`, cleanerC);
    check("mgr alerts: EMPLOYEE 403", e.status === 403, e.body);
    const mr = await post(`${M}/alerts/read`, leadC, { ids: [nG.id, nO.id, nB.id, "nope"] }, "");
    const reads = await db.notificationRead.findMany({ where: { userId: lead.id }, select: { notificationId: true } });
    check(
      "mgr alerts read: a lead marks only their own feed's rows",
      mr.status === 200 && mr.body?.unreadCount === 0 && reads.length === 1 && reads[0].notificationId === nG.id,
      { body: mr.body, reads },
    );
    const ob = await post(`${M}/alerts/read`, owner, { ids: [nB.id] }, "");
    const bReads = await db.notificationRead.count({ where: { notificationId: nB.id } });
    check("mgr alerts read: another company's id is ignored", ob.status === 200 && bReads === 0, { body: ob.body, bReads });
  }

  // ── Late arrivals ──────────────────────────────────────────────────────
  {
    const startG = now - 3 * HOUR;
    const lateG = await job(A, grp.id, startG, "LG", { isFlexible: false });
    const lateAt = new Date(startG + 50 * 60_000);
    await session(A, lateG.id, grp.id, lateAt, null);
    await db.job.update({ where: { id: lateG.id }, data: { lateArrivalAt: lateAt, lateArrivalRatingPenalty: 0.5 } });
    const lateO = await job(A, outsider.id, startG, "LO");
    const lateOAt = new Date(startG + 15 * 60_000);
    await session(A, lateO.id, outsider.id, lateOAt, null);
    await db.job.update({ where: { id: lateO.id }, data: { lateArrivalAt: lateOAt, lateArrivalRatingPenalty: 0.5 } });

    const o = await get(`${M}/late-arrivals`, owner);
    const items = o.body?.items ?? [];
    const g = items.find((i: { job: { id: string } }) => i.job.id === lateG.id);
    check(
      "mgr late: OWNER sees the company's, with minutes and the strike",
      o.status === 200 && !!g && g.minutesLate === 50 && g.strike === true && g.cleaner.id === grp.id && items.some((i: { job: { id: string } }) => i.job.id === lateO.id),
      g,
    );
    const l = await get(`${M}/late-arrivals`, leadC);
    const lj = (l.body?.items ?? []).map((i: { job: { id: string } }) => i.job.id);
    check("mgr late: FIELD_LEAD sees their group's only", l.status === 200 && lj.includes(lateG.id) && !lj.includes(lateO.id), lj);
    const e = await get(`${M}/late-arrivals`, cleanerC);
    check("mgr late: EMPLOYEE 403", e.status === 403, e.body);
  }

  // ── Problems cleaners reported ─────────────────────────────────────────
  {
    const issue = (org: string, jobId: string, urgency: string, status = "OPEN", photoUrl: string | null = null) =>
      db.jobIssue.create({
        data: { organizationId: org, jobId, reportedByName: "Grp Mgr", category: "OTHER", urgency, status, description: "Broken tap", photoUrl },
        select: { id: true },
      });
    const iNormal = await issue(A, jobG.id, "NORMAL", "OPEN", "https://evil.example.com/x.jpg");
    const iUrgent = await issue(A, jobG.id, "URGENT");
    const iB = await issue(B, jobB.id, "URGENT");
    const o = await get(`${M}/issues?status=open`, owner);
    const oi = ids(o);
    check("mgr issues: OWNER's open list, urgent first", o.status === 200 && oi[0] === iUrgent.id && oi.includes(iNormal.id) && !oi.includes(iB.id) && o.body?.openCount >= 2, oi);
    const n = (o.body?.items ?? []).find((i: { id: string }) => i.id === iNormal.id);
    check("mgr issues: a photo URL off the company's storage is dropped", n?.photoUrl === null, n);
    for (const [who, c] of [["OPS_MANAGER", opsC], ["FIELD_LEAD", leadC], ["EMPLOYEE", cleanerC]] as const) {
      const r = await get(`${M}/issues`, c);
      check(`mgr issues: ${who} 403`, r.status === 403, r.body);
    }
    const ob = await get(`${M}/issues/${iB.id}`, owner);
    check("mgr issue: another company's 404", ob.status === 404, ob.body);
    const noNote = await post(`${M}/issues/${iUrgent.id}/status`, owner, { status: "RESOLVED", clientEventId: randomUUID() });
    check("mgr issue status: RESOLVED without a note 400 NOTE_REQUIRED", noNote.status === 400 && code(noNote) === "NOTE_REQUIRED", noNote.body);
    const body = { status: "RESOLVED", resolutionNote: "Plumber booked for Monday", clientEventId: randomUUID() };
    const res = await post(`${M}/issues/${iUrgent.id}/status`, owner, body);
    const replay = await post(`${M}/issues/${iUrgent.id}/status`, owner, body);
    check(
      "mgr issue status: OWNER resolves with a note; resolvedBy is them",
      res.status === 200 && res.body?.status === "RESOLVED" && res.body?.resolutionNote === "Plumber booked for Monday" && !!res.body?.resolvedBy,
      res.body,
    );
    check("mgr issue status: replay answers the stored response", replay.headers["idempotent-replayed"] === "true", replay.headers);
    const bSet = await post(`${M}/issues/${iB.id}/status`, owner, { status: "ACKNOWLEDGED", clientEventId: randomUUID() });
    check("mgr issue status: another company's 404", bSet.status === 404, bSet.body);
    const resolved = await get(`${M}/issues?status=resolved`, owner);
    check("mgr issues: the resolved list", resolved.status === 200 && ids(resolved).includes(iUrgent.id), ids(resolved));
  }

  // ── The office inbox ───────────────────────────────────────────────────
  {
    // A field lead writes to the office from the cleaner screens.
    const sent = await post("/api/v1/chat/messages", leadC, { body: "Van has a flat", clientEventId: randomUUID() });
    check("mgr inbox: a lead writes to the office as EMPLOYEE", sent.status === 200 && sent.body?.senderRole === "EMPLOYEE", sent.body);

    const list = await get(`${M}/chat/conversations`, owner);
    const people = (list.body?.items ?? []).map((c: { cleaner: { id: string } }) => c.cleaner.id);
    const leadConv = (list.body?.items ?? []).find((c: { cleaner: { id: string } }) => c.cleaner.id === lead.id);
    const flags: boolean[] = (list.body?.items ?? []).map((c: { unreadCount: number }) => c.unreadCount > 0);
    const unreadFirst = flags.every((f, i) => i === 0 || !f || flags[i - 1]);
    check(
      "mgr inbox: OWNER lists EMPLOYEE, FIELD_LEAD and OPS_MANAGER conversations, unread first",
      list.status === 200 && people.includes(grp.id) && people.includes(lead.id) && people.includes(ops.id) && !people.includes(F.users.owner.id) && !people.includes(F.users.client.id) && leadConv?.unreadCount === 1 && unreadFirst && list.body?.unreadTotal >= 1,
      { people: people.slice(0, 5), leadConv, total: list.body?.unreadTotal },
    );
    for (const [who, c] of [["OPS_MANAGER", opsC], ["FIELD_LEAD", leadC], ["EMPLOYEE", cleanerC]] as const) {
      const r = await get(`${M}/chat/conversations`, c);
      check(`mgr inbox: ${who} 403`, r.status === 403, r.body);
    }
    const one = await get(`${M}/chat/conversations/${lead.id}`, owner);
    check("mgr inbox: a field lead's thread opens", one.status === 200 && one.body?.cleaner?.id === lead.id, one.body);
    const other = await get(`${M}/chat/conversations/${F.users.bCleaner.id}`, owner);
    check("mgr inbox: another company's person 404", other.status === 404, other.body);
    const client = await get(`${M}/chat/conversations/${F.users.client.id}`, owner);
    check("mgr inbox: a client 404", client.status === 404, client.body);

    const msgs = await get(`${M}/chat/conversations/${lead.id}/messages`, owner);
    const first = msgs.body?.items?.[0];
    check("mgr inbox: the lead's message reads from the office's side", msgs.status === 200 && first?.fromMe === false && first?.senderRole === "EMPLOYEE", first);

    const replyBody = { body: "Tow truck is on the way", clientEventId: randomUUID() };
    const reply = await post(`${M}/chat/conversations/${lead.id}/messages`, owner, replyBody);
    const again = await post(`${M}/chat/conversations/${lead.id}/messages`, owner, replyBody);
    const stored = await db.chatMessage.findMany({ where: { senderId: F.users.owner.id, clientEventId: replyBody.clientEventId } });
    check(
      "mgr inbox reply: posted as the office (ADMIN), by the caller, once",
      reply.status === 200 && reply.body?.fromMe === true && reply.body?.senderRole === "ADMIN" && stored.length === 1 && stored[0].senderRole === "ADMIN" && !!stored[0].readByAdminAt,
      { body: reply.body, stored: stored.length },
    );
    check("mgr inbox reply: replay answers the stored response", again.headers["idempotent-replayed"] === "true", again.headers);
    const theirs = await get("/api/v1/chat/messages", leadC);
    const top = theirs.body?.items?.[0];
    check("mgr inbox reply: the lead sees it from the office", top?.senderRole === "ADMIN" && top?.fromMe === false && top?.body === "Tow truck is on the way", top);
    const byOther = await get(`${M}/chat/conversations/${lead.id}/messages`, admin2C);
    const ownerMsg = (byOther.body?.items ?? []).find((m: { body: string }) => m.body === "Tow truck is on the way");
    check("mgr inbox: another admin sees the office's reply as the office's, without its key", ownerMsg?.fromMe === true && ownerMsg?.clientEventId === null, ownerMsg);
    const eReply = await post(`${M}/chat/conversations/${lead.id}/messages`, leadC, { body: "hi", clientEventId: randomUUID() });
    check("mgr inbox reply: FIELD_LEAD 403", eReply.status === 403, eReply.body);
    const bReply = await post(`${M}/chat/conversations/${F.users.bCleaner.id}/messages`, owner, { body: "hi", clientEventId: randomUUID() });
    check("mgr inbox reply: another company's person 404", bReply.status === 404, bReply.body);

    const read = await post(`${M}/chat/conversations/${lead.id}/read`, owner, {}, "");
    const unread = await db.chatMessage.count({ where: { conversation: { employeeId: lead.id }, senderRole: "EMPLOYEE", readByAdminAt: null } });
    check("mgr inbox read: stamps the office's read on the lead's messages", read.status === 200 && unread === 0 && typeof read.body?.unreadTotal === "number", { body: read.body, unread });
    const bRead = await post(`${M}/chat/conversations/${F.users.bCleaner.id}/read`, owner, {}, "");
    check("mgr inbox read: another company's person 404", bRead.status === 404, bRead.body);
  }

  // ── Moderating team chat ───────────────────────────────────────────────
  {
    const ch = await get("/api/v1/team/channels", cleanerC);
    const general = (ch.body?.items ?? []).find((c: { kind?: string }) => c.kind === "DEFAULT");
    const channelId: string | undefined = general?.id;
    const sent = channelId
      ? await post(`/api/v1/team/channels/${channelId}/messages`, cleanerC, { body: "Anyone have a spare mop?", clientEventId: randomUUID() })
      : null;
    const messageId: string | undefined = sent?.body?.id;
    check("mgr moderate: a cleaner posts in the team channel", !!channelId && sent?.status === 200 && !!messageId, { ch: ch.body, sent: sent?.body });
    if (channelId && messageId) {
      const e = await del(`${M}/team/channels/${channelId}/messages/${messageId}`, grpC);
      check("mgr moderate: EMPLOYEE 403", e.status === 403, e.body);
      const l = await del(`${M}/team/channels/${channelId}/messages/${messageId}`, leadC);
      check("mgr moderate: FIELD_LEAD 403", l.status === 403, l.body);
      const bCh = await db.groupChannel.create({ data: { organizationId: B, name: "B general", isDefault: false }, select: { id: true } });
      const wrong = await del(`${M}/team/channels/${bCh.id}/messages/${messageId}`, opsC);
      check("mgr moderate: another company's channel 404", wrong.status === 404, wrong.body);
      const d = await del(`${M}/team/channels/${channelId}/messages/${messageId}`, opsC);
      const row = await db.groupMessage.findUnique({ where: { id: messageId } });
      check(
        "mgr moderate: OPS_MANAGER removes it; who is recorded; the original is kept",
        d.status === 200 && d.body?.id === messageId && !!row?.deletedAt && row?.deletedById === ops.id && row?.body === "Anyone have a spare mop?",
        { body: d.body, row: { deletedById: row?.deletedById, kept: row?.body } },
      );
      const d2 = await del(`${M}/team/channels/${channelId}/messages/${messageId}`, owner);
      const row2 = await db.groupMessage.findUnique({ where: { id: messageId } });
      check("mgr moderate: a second removal changes nothing", d2.status === 200 && row2?.deletedById === ops.id, { body: d2.body, by: row2?.deletedById });
      const seen = await get(`/api/v1/team/channels/${channelId}/messages`, grpC);
      const m = (seen.body?.items ?? []).find((x: { id: string }) => x.id === messageId);
      check("mgr moderate: everyone sees it deleted, without its text", m?.deleted === true && !m?.body, m);
      const logs = await db.activityLog.count({ where: { organizationId: A, action: "groupchat.message.deleted", targetId: messageId } });
      check("mgr moderate: one activity line", logs === 1, logs);
    }
  }

  void bOwner;
}

// ── Standalone ─────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("manager.ts")) {
  const PORT = Number(process.env.V1_PORT ?? 3100);
  const HOST_A = `${SLUG_A}.localhost:${PORT}`;
  const HOST_B = `${SLUG_B}.localhost:${PORT}`;
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => {
    if (ok) {
      pass++;
      console.log(`PASS  ${name}`);
    } else {
      fail++;
      failures.push(name);
      console.log(`FAIL  ${name}${detail === undefined ? "" : `\n        ${JSON.stringify(detail).slice(0, 800)}`}`);
    }
  };
  const callOnce = (
    method: string,
    host: string,
    path: string,
    opts: { cookie?: string; body?: unknown; headers?: Record<string, string>; noAppHeaders?: boolean } = {},
  ): Promise<Res> => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = {
      Host: host,
      Accept: "application/json",
      ...(opts.noAppHeaders ? {} : { "X-App-Version": "1.0.0 (1)", "X-App-Platform": "ios" }),
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...opts.headers,
    };
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            body = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text });
        });
      });
      req.on("error", reject);
      req.setTimeout(400_000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  };
  let retries = 0;
  const call: ManagerHarness["call"] = async (method, host, path, opts = {}) => {
    for (let attempt = 1; ; attempt++) {
      const res = await callOnce(method, host, path, opts);
      if (res.status < 500 || attempt >= 4) return res;
      retries++;
      console.log(`  (retry ${attempt}: ${method} ${path} answered ${res.status})`);
      await new Promise((r) => setTimeout(r, 3_000 * attempt));
    }
  };
  const signIn = async (host: string, email: string) => {
    const res = await callOnce("POST", host, "/api/auth/sign-in/email", {
      body: { email, password: PASSWORD },
      noAppHeaders: true,
      headers: { Origin: `http://${host}` },
    });
    const m = (res.headers["set-cookie"] ?? [])
      .map((c) => /^((?:__Secure-)?better-auth\.session_token)=([^;]+)/.exec(c))
      .find(Boolean);
    if (res.status !== 200 || !m) throw new Error(`sign-in ${email} failed: ${res.status} ${res.text.slice(0, 200)}`);
    return `${m[1]}=${m[2]}`;
  };

  (async () => {
    const db = openDb();
    let made = false;
    try {
      const up = await callOnce("GET", `localhost:${PORT}`, "/api/v1/meta").catch(() => null);
      if (!up) throw new Error(`no server on :${PORT}`);
      const F = await createFixture(db);
      made = true;
      console.log(`fixture: ${SLUG_A} ${F.orgA.id}, ${SLUG_B} ${F.orgB.id}`);
      await managerChecks({ db, F, HOST_A, HOST_B, call, check, signIn });
    } finally {
      if (made && !process.argv.includes("--keep")) {
        await removeFixture(db).catch((e) => console.error("cleanup failed:", e));
        const left = await db.organization.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
        console.log(left === 0 ? "cleanup: both test companies removed" : `cleanup: ${left} left behind`);
      }
      await db.$disconnect();
    }
    console.log(`\n${pass} passed, ${fail} failed (${retries} requests retried after a 5xx)`);
    if (fail) {
      console.log(failures.map((f) => `  - ${f}`).join("\n"));
      process.exitCode = 1;
    }
  })().catch((e) => {
    console.error("RUN FAILED:", e);
    process.exitCode = 1;
  });
}
