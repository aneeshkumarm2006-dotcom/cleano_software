// "On my way": a cleaner tells the office, and the client, that they're
// heading to a job.
//
// The web's markOnMyWay (app/cleaners/my-jobs/[jobId]/onMyWay.ts) is a thin
// adapter over markOnMyWayFor with door "web"; the phone's
// POST /jobs/:id/on-my-way uses door "phone", which adds the contract's
// stricter rules (packages/api/src/v1/on-my-way.ts): today only, not on a
// closed job, not once this cleaner has clocked in, and once per cleaner.
//
// What both doors share, unchanged from the web:
//   - the job-level `onMyWayAt` is set once; whoever sets it notifies the
//     office and (when the booking allows) texts the client. A teammate
//     tapping later records only their own assignment status;
//   - a position is kept only when the company's `tracking.gpsEnabled` is on,
//     and otherwise is dropped unread.
// New for both: the job-level stamp is a conditional update, so two taps at
// once can't both notify, and the three writes are one transaction.
import "server-only";

import type { OnMyWayResponse, OnMyWayState } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { cleanerAssignedWhere } from "@/lib/cleaner-jobs";
import { sendAdminOnTheWay } from "@/lib/email";
import { isNotificationEnabled } from "@/lib/notifications";
import { db } from "@/lib/org-db";
import { getSetting } from "@/lib/settings";
import { smsOnTheWay } from "@/lib/sms";
import { storeDateKey } from "@/lib/timezone";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, notFound, ok, type Result } from "../result";

/** Default ETA (minutes) advertised to the customer, as the web's. */
const DEFAULT_ETA_MIN = 15;

const CLOSED_STATUSES = new Set(["COMPLETED", "PAID", "CANCELLED"]);

const JOB_SELECT = {
  id: true,
  jobNumber: true,
  clientName: true,
  status: true,
  startTime: true,
  employeeId: true,
  onMyWayAt: true,
  clockInTime: true,
  notifyClient: true,
  cleaners: { select: { id: true } },
  client: { select: { phone: true } },
} satisfies Prisma.JobSelect;

type OmwJob = Prisma.JobGetPayload<{ select: typeof JOB_SELECT }>;

async function phoneJob(actor: Actor, jobId: string): Promise<OmwJob | null> {
  const base = cleanerAssignedWhere(actor.userId);
  return db.job.findFirst({
    where: { ...base, AND: [...(base.AND as Prisma.JobWhereInput[]), { id: jobId }] },
    select: JOB_SELECT,
  });
}

/** Whether this cleaner has clocked in on the job: a work session of theirs, or their assignment says so. */
async function hasStarted(jobId: string, cleanerId: string): Promise<boolean> {
  const [session, assignment] = await Promise.all([
    db.jobWorkSession.findFirst({ where: { jobId, cleanerId }, select: { id: true } }),
    db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      select: { clockInTime: true },
    }),
  ]);
  return !!session || !!assignment?.clockInTime;
}

async function gpsEnabled(): Promise<boolean> {
  return (await getSetting("tracking.gpsEnabled")) === true;
}

export async function onMyWayState(actor: Actor, jobId: string): Promise<Result<OnMyWayState>> {
  const job = await phoneJob(actor, jobId);
  if (!job) return notFound("This job isn't available.");
  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_cleanerId: { jobId: job.id, cleanerId: actor.userId } },
    select: { onMyWayAt: true },
  });
  return ok({
    sentAt: assignment?.onMyWayAt ? assignment.onMyWayAt.toISOString() : null,
    askForLocation: await gpsEnabled(),
  });
}

export interface MarkOnMyWayInput {
  jobId: string;
  coords?: { lat: number; lng: number };
  now: Date;
  door: "web" | "phone";
}

export interface MarkOnMyWayResult extends OnMyWayResponse {
  /** The job-level stamp was already set (by this cleaner or a teammate): the web's `alreadySet`. */
  jobAlreadySet: boolean;
  /** The job-level stamp, for the web's answer. */
  jobOnMyWayAt: string;
}

export async function markOnMyWayFor(actor: Actor, input: MarkOnMyWayInput): Promise<Result<MarkOnMyWayResult>> {
  let job: OmwJob | null;
  if (input.door === "phone") {
    job = await phoneJob(actor, input.jobId);
    if (!job) return notFound("This job isn't available.");
  } else {
    job = await db.job.findUnique({ where: { id: input.jobId }, select: JOB_SELECT });
    if (!job) return failure(404, "NOT_FOUND", "Job not found");
    const onJob = job.employeeId === actor.userId || job.cleaners.some((c) => c.id === actor.userId);
    if (!onJob) return failure(404, "NOT_ON_JOB", "You are not assigned to this job");
  }

  const now = input.now;

  if (input.door === "phone") {
    // Once per cleaner: a second tap answers with the first, and tells no one.
    const mine = await db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId: job.id, cleanerId: actor.userId } },
      select: { onMyWayAt: true },
    });
    if (mine?.onMyWayAt) {
      return ok({
        sentAt: mine.onMyWayAt.toISOString(),
        alreadySent: true,
        officeTold: false,
        clientTold: false,
        locationSaved: false,
        jobAlreadySet: true,
        jobOnMyWayAt: (job.onMyWayAt ?? mine.onMyWayAt).toISOString(),
      });
    }
    if (CLOSED_STATUSES.has(job.status)) {
      return failure(409, "JOB_CLOSED", "This job is finished or cancelled.");
    }
    if (storeDateKey(job.startTime) !== storeDateKey(now)) {
      return failure(409, "NOT_TODAY", "You can only say you're on your way to today's jobs.");
    }
    if (await hasStarted(job.id, actor.userId)) {
      return failure(409, "ALREADY_STARTED", "You've already clocked in on this job.");
    }
  }

  const gps = await gpsEnabled();
  const coords = gps && input.coords ? input.coords : null;
  const cleanerName = actor.name ?? "Cleaner";

  // One transaction: the job-level stamp (only if nobody set it yet), this
  // cleaner's assignment, and the timeline line.
  const outcome = await db.$transaction(async (tx) => {
    // The phone's once-per-cleaner rule, race-safe: this cleaner's stamp is
    // set only while it is empty, so of two taps at once only one goes on.
    if (input.door === "phone") {
      const claimed = await tx.jobAssignment.updateMany({
        where: { jobId: job.id, cleanerId: actor.userId, onMyWayAt: null },
        data: { status: "ON_THE_WAY", onMyWayAt: now },
      });
      if (claimed.count === 0) {
        const row = await tx.jobAssignment.findUnique({
          where: { jobId_cleanerId: { jobId: job.id, cleanerId: actor.userId } },
          select: { onMyWayAt: true },
        });
        if (row?.onMyWayAt) return { kind: "mine" as const, sentAt: row.onMyWayAt };
        await tx.jobAssignment.create({
          data: { jobId: job.id, cleanerId: actor.userId, status: "ON_THE_WAY", onMyWayAt: now },
        });
      }
    }

    const won =
      job.onMyWayAt === null &&
      (
        await tx.job.updateMany({
          where: { id: job.id, onMyWayAt: null },
          data: {
            onMyWayAt: now,
            ...(coords ? { onMyWayLat: coords.lat, onMyWayLng: coords.lng, onMyWayLocationAt: now } : {}),
          },
        })
      ).count === 1;

    // Per-cleaner assignment status (item 9), for the web. It recorded it for
    // a teammate only while the job had no clock-in; kept.
    if (input.door === "web" && (won || !job.clockInTime)) {
      await tx.jobAssignment.upsert({
        where: { jobId_cleanerId: { jobId: job.id, cleanerId: actor.userId } },
        update: { status: "ON_THE_WAY", onMyWayAt: now },
        create: { jobId: job.id, cleanerId: actor.userId, status: "ON_THE_WAY", onMyWayAt: now },
      });
    }

    if (won) {
      await tx.jobLog.create({
        data: {
          jobId: job.id,
          userId: actor.userId,
          action: "NOTE_ADDED",
          description: `${cleanerName} is on the way${coords ? " (location shared)" : ""}`,
        },
      });
      return { kind: "won" as const, jobStamp: now };
    }
    const fresh = await tx.job.findFirst({ where: { id: job.id }, select: { onMyWayAt: true } });
    return { kind: "teammate" as const, jobStamp: fresh?.onMyWayAt ?? job.onMyWayAt ?? now };
  });

  if (outcome.kind === "mine") {
    return ok({
      sentAt: outcome.sentAt.toISOString(),
      alreadySent: true,
      officeTold: false,
      clientTold: false,
      locationSaved: false,
      jobAlreadySet: true,
      jobOnMyWayAt: (job.onMyWayAt ?? outcome.sentAt).toISOString(),
    });
  }
  const won = outcome.kind === "won";

  const effects: Effect[] = [];
  let officeTold = false;
  let clientTold = false;
  if (won) {
    // Customer SMS — gated by `cust.booking.on_the_way` inside smsOnTheWay
    // AND the per-booking notifyClient toggle.
    const phone = job.notifyClient ? job.client?.phone : null;
    if (phone) {
      clientTold = await isNotificationEnabled("CUSTOMER", "cust.booking.on_the_way", "SMS");
      effects.push(
        effect("on-the-way customer sms", () =>
          smsOnTheWay({ to: phone, cleanerName: actor.name ?? "Your cleaner", etaMin: DEFAULT_ETA_MIN }),
        ),
      );
    }
    // Admin notification — gated by `admin.clock.on_the_way`.
    officeTold = await isNotificationEnabled("ADMIN", "admin.clock.on_the_way", "EMAIL");
    effects.push(
      effect("admin on-the-way email", () =>
        sendAdminOnTheWay({ jobId: job.id, jobNumber: job.jobNumber, clientName: job.clientName, cleanerName }),
      ),
    );
  }

  return ok(
    {
      sentAt: now.toISOString(),
      alreadySent: false,
      officeTold,
      clientTold,
      locationSaved: won && !!coords,
      jobAlreadySet: !won,
      jobOnMyWayAt: outcome.jobStamp.toISOString(),
    },
    effects,
  );
}
