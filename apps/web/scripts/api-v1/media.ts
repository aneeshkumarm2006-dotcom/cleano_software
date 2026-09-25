/**
 * API v1 integration checks for job media and notices: uploads, photos,
 * issues, "on my way" and announcements (packages/api/src/v1/photos.ts,
 * issues.ts, on-my-way.ts, announcements.ts). Called from
 * scripts/api-v1-integration.ts with the harness's helpers.
 *
 * Real Cloudinary is used when the test process has CLOUDINARY_CLOUD_NAME,
 * CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (the same account the server
 * signs with). Files go only under the throwaway company's folder
 * (awer/<test slug>/...), and everything under that folder is deleted at the
 * end. Without the three, the upload-dependent checks are reported as SKIP.
 */
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";

import type { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";

import type { Fixture } from "./fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  text: string;
}
type Call = (
  method: string,
  host: string,
  path: string,
  opts?: { cookie?: string; body?: unknown; headers?: Record<string, string>; noAppHeaders?: boolean },
) => Promise<Res>;

export interface MediaHarness {
  db: PrismaClient;
  F: Fixture;
  host: string;
  slugA: string;
  call: Call;
  check: (name: string, ok: boolean, detail?: unknown) => void;
  signIn: (host: string, email: string) => Promise<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Test images ─────────────────────────────────────────────────────────────

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A real 8x8 PNG, a different colour each call, so each upload is its own file. */
function pngImage(seed: number): Buffer {
  const w = 8;
  const h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (seed * 37) & 0xff;
      raw[o + 1] = (seed * 91 + x * 20) & 0xff;
      raw[o + 2] = (y * 30) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const GIF_1x1 = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

// ── The checks ──────────────────────────────────────────────────────────────

export async function mediaChecks(h: MediaHarness): Promise<void> {
  const { db, F, host, call, check } = h;
  const orgA = F.orgA.id;
  const cloud = {
    name: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    key: process.env.CLOUDINARY_API_KEY ?? "",
    secret: process.env.CLOUDINARY_API_SECRET ?? "",
  };
  const realCloudinary = !!(cloud.name && cloud.key && cloud.secret);
  if (realCloudinary) cloudinary.config({ cloud_name: cloud.name, api_key: cloud.key, api_secret: cloud.secret, secure: true });
  const skip = (name: string) => console.log(`SKIP  ${name} (no Cloudinary credentials in the test process)`);
  const testFolder = `awer/${h.slugA}/`;
  if (!testFolder.startsWith("awer/v1test-")) throw new Error("media checks: refusing a non-test folder");

  const cookie = await h.signIn(host, F.users.cleaner.email);
  const teammate = await h.signIn(host, F.users.teammate.email);
  const owner = await h.signIn(host, F.users.owner.email);
  const applicant = await h.signIn(host, F.users.applicant.email);

  const post = (path: string, who: string, body: Record<string, unknown>, key?: string) =>
    call("POST", host, path, {
      cookie: who,
      body,
      headers: key ?? (body.clientEventId as string | undefined) ? { "Idempotency-Key": key ?? (body.clientEventId as string) } : {},
    });
  const del = (path: string, who: string) => call("DELETE", host, path, { cookie: who, body: {} });

  // Jobs of our own, so no other section's clock state matters.
  let n = 9500;
  async function job(
    label: string,
    startMs: number,
    extra: { status?: "SCHEDULED" | "PAID" | "CANCELLED" | "COMPLETED"; afterPhotoConsent?: boolean; crew?: string[] } = {},
  ) {
    const crew = extra.crew ?? [F.users.cleaner.id];
    const start = new Date(startMs);
    const j = await db.job.create({
      data: {
        organizationId: orgA,
        jobNumber: n++,
        clientName: `Prem Sai Media ${label}`,
        employeeId: crew[0],
        jobType: "Standard Clean",
        location: `${n} Media Street`,
        startTime: start,
        endTime: new Date(start.getTime() + 3 * 3600_000),
        jobDate: start,
        status: extra.status ?? "SCHEDULED",
        price: 120,
        subtotalAmount: 120,
        requiredCleaners: crew.length,
        afterPhotoConsent: extra.afterPhotoConsent ?? true,
        cleaners: { connect: crew.map((id) => ({ id })) },
      },
      select: { id: true },
    });
    for (const cleanerId of crew) await db.jobAssignment.create({ data: { organizationId: orgA, jobId: j.id, cleanerId } });
    return j.id;
  }
  const soon = Date.now() + 2 * 60_000;
  const jobs = {
    main: await job("main", soon),
    off: await job("photos off", soon, { afterPhotoConsent: false }),
    paid: await job("paid", soon, { status: "PAID" }),
    cap: await job("cap", soon),
    tomorrow: await job("tomorrow", Date.now() + 26 * 3600_000),
    started: await job("started", soon),
    shared: await job("shared", soon, { crew: [F.users.teammate.id, F.users.cleaner.id] }),
    gps: await job("gps", soon),
    teammates: F.jobs.teammates,
    otherCompany: F.jobs.otherCompany,
  };
  const J = (id: string) => `/api/v1/jobs/${id}`;

  // GPS off to start with (settings are cached per server for 30 s, so it is
  // set before anything reads it, and flipped on once, near the end).
  await db.appSetting.create({ data: { organizationId: orgA, key: "tracking.gpsEnabled", category: "scheduling", value: false } });

  const ticket = async (jobId: string, who = cookie, body: Record<string, unknown> = {}) =>
    post("/api/v1/uploads", who, { purpose: "JOB_PHOTO", jobId, contentType: "image/png", byteSize: 2048, ...body });

  /** Send a file to Cloudinary with a ticket's fields, as the app does. */
  async function sendToCloudinary(t: any, file: Buffer, fields: Record<string, string> = t.fields, name = "p.png") {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append(t.fileField, new Blob([new Uint8Array(file)]), name);
    const r = await fetch(t.uploadUrl, { method: "POST", body: form });
    const text = await r.text();
    return { status: r.status, text };
  }
  async function uploaded(jobId: string, seed: number, who = cookie): Promise<string | null> {
    const t = await ticket(jobId, who);
    if (t.status !== 200) return null;
    const up = await sendToCloudinary(t.body, pngImage(seed));
    return up.status === 200 ? t.body.key : null;
  }

  // ── Uploads ────────────────────────────────────────────────────────────
  {
    const t = await ticket(jobs.main);
    const f = t.body?.fields ?? {};
    check("uploads: 200 with a ticket", t.status === 200, t.body);
    check(
      "uploads: the ticket points only at Cloudinary's image upload for this cloud",
      (realCloudinary
        ? t.body?.uploadUrl === `https://api.cloudinary.com/v1_1/${cloud.name}/image/upload`
        : /^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/upload$/.test(t.body?.uploadUrl ?? "")) &&
        t.body?.method === "MULTIPART_POST" &&
        t.body?.fileField === "file",
      t.body,
    );
    check(
      "uploads: signs exactly public_id, timestamp, allowed_formats, overwrite (+ api_key, signature)",
      JSON.stringify(Object.keys(f).sort()) ===
        JSON.stringify(["allowed_formats", "api_key", "overwrite", "public_id", "signature", "timestamp"]),
      Object.keys(f),
    );
    check("uploads: image formats only, never overwrite", f.allowed_formats === "jpg,png,heic,heif,webp" && f.overwrite === "false", f);
    const ts = Number(f.timestamp);
    check("uploads: a fresh timestamp, and expiresAt one hour on", Math.abs(ts * 1000 - Date.now()) < 120_000 && new Date(t.body?.expiresAt).getTime() === (ts + 3600) * 1000, { ts, exp: t.body?.expiresAt });
    check(
      "uploads: the server names the asset under company/job/person",
      typeof t.body?.key === "string" &&
        t.body.key === f.public_id &&
        new RegExp(`^awer/${h.slugA}/jobs/${jobs.main}/${F.users.cleaner.id}/[a-f0-9]{32}$`).test(t.body.key),
      t.body?.key,
    );
    check(
      "uploads: the API secret never leaves the server",
      !/secret/i.test(t.text) && (!cloud.secret || !t.text.includes(cloud.secret)),
    );
    const row = await db.mediaUpload.findFirst({ where: { publicId: t.body?.key } });
    check("uploads: the ticket is recorded for this person and job", row?.userId === F.users.cleaner.id && row.jobId === jobs.main && row.usedAt === null, row);

    const gif = await ticket(jobs.main, cookie, { contentType: "image/gif" });
    check("uploads: a GIF is 400", gif.status === 400 && gif.body?.error?.code === "VALIDATION_FAILED", gif.body);
    const big = await ticket(jobs.main, cookie, { byteSize: 10 * 1024 * 1024 + 1 });
    check("uploads: over 10 MB is 400", big.status === 400, big.body);
    const purpose = await ticket(jobs.main, cookie, { purpose: "DOCUMENT" });
    check("uploads: an unknown purpose is 400", purpose.status === 400, purpose.body);
    const theirs = await ticket(jobs.teammates);
    check("uploads: a teammate's job is 404", theirs.status === 404 && theirs.body?.error?.code === "NOT_FOUND", theirs.body);
    const other = await ticket(jobs.otherCompany);
    check("uploads: another company's job is 404", other.status === 404, other.body);
    const paid = await ticket(jobs.paid);
    check("uploads: a paid job is 409 PHOTOS_CLOSED", paid.status === 409 && paid.body?.error?.code === "PHOTOS_CLOSED", paid.body);
    const off = await ticket(jobs.off);
    check("uploads: the photo switch doesn't refuse a ticket (an issue photo may use it)", off.status === 200, off.body);
    const role = await ticket(jobs.main, owner);
    check("uploads: an OWNER is 403 (crew only)", role.status === 403 && role.body?.error?.code === "ROLE_NOT_ALLOWED", role.body);

    if (realCloudinary) {
      const tampered = await sendToCloudinary(t.body, pngImage(1), { ...f, public_id: `${testFolder}elsewhere` });
      check("cloudinary: a changed public_id is refused by Cloudinary", tampered.status === 401 || tampered.status === 400, tampered);
      const added = await sendToCloudinary(t.body, pngImage(1), { ...f, folder: `${testFolder}x` });
      check("cloudinary: an added field is refused by Cloudinary", added.status === 401 || added.status === 400, added);
      const gifUp = await sendToCloudinary(t.body, GIF_1x1, f, "p.gif");
      check("cloudinary: a GIF on a valid ticket is refused (allowed_formats)", gifUp.status === 400, gifUp);
    } else {
      skip("cloudinary: tampered, added-field and GIF uploads refused");
    }
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  {
    const list = await call("GET", host, `${J(jobs.main)}/photos`, { cookie });
    check(
      "photos: an empty job lists nothing, with the policy",
      list.status === 200 &&
        list.body?.items?.length === 0 &&
        list.body.total === 0 &&
        list.body.policy?.canAdd === true &&
        list.body.policy.photosAllowed === true &&
        list.body.policy.maxPhotos === 200 &&
        list.body.policy.maxBytes === 10 * 1024 * 1024,
      list.body,
    );
    const offList = await call("GET", host, `${J(jobs.off)}/photos`, { cookie });
    check("photos: photos off → canAdd false, photosAllowed false", offList.body?.policy?.canAdd === false && offList.body.policy.photosAllowed === false, offList.body?.policy);
    const paidList = await call("GET", host, `${J(jobs.paid)}/photos`, { cookie });
    check("photos: a paid job → canAdd false with a reason", paidList.body?.policy?.canAdd === false && typeof paidList.body.policy.closedReason === "string", paidList.body?.policy);
    const theirs = await call("GET", host, `${J(jobs.teammates)}/photos`, { cookie });
    check("photos: a teammate's job is 404", theirs.status === 404, theirs.body);
    const other = await call("GET", host, `${J(jobs.otherCompany)}/photos`, { cookie });
    check("photos: another company's job is 404", other.status === 404, other.body);
    const badCursor = await call("GET", host, `${J(jobs.main)}/photos?cursor=nope`, { cookie });
    check("photos: a bad cursor is 400", badCursor.status === 400, badCursor.body);

    // Attaching a key that was signed but never sent.
    const never = await ticket(jobs.main);
    const missingBody = { key: never.body?.key, phase: "BEFORE", clientEventId: randomUUID() };
    if (realCloudinary) {
      const missing = await post(`${J(jobs.main)}/photos`, cookie, missingBody);
      check("attach: a key never uploaded is 409 UPLOAD_MISSING, not retryable", missing.status === 409 && missing.body?.error?.code === "UPLOAD_MISSING" && missing.body.error.retryable === false, missing.body);
    } else skip("attach: UPLOAD_MISSING");

    const made = `${testFolder}jobs/${jobs.main}/${F.users.cleaner.id}/my-own-name`;
    const named = await post(`${J(jobs.main)}/photos`, cookie, { key: made, phase: "BEFORE", clientEventId: randomUUID() });
    check("attach: a key the app named is 404", named.status === 404, named.body);
    const mateTicket = await call("POST", host, "/api/v1/uploads", {
      cookie: teammate,
      body: { purpose: "JOB_PHOTO", jobId: jobs.teammates, contentType: "image/png", byteSize: 100 },
    });
    const mateKey = await post(`${J(jobs.main)}/photos`, cookie, { key: mateTicket.body?.key, phase: "BEFORE", clientEventId: randomUUID() });
    check("attach: a teammate's key is 404", mateTicket.status === 200 && mateKey.status === 404, { t: mateTicket.status, a: mateKey.body });
    const offTicket = await ticket(jobs.off);
    const crossJob = await post(`${J(jobs.main)}/photos`, cookie, { key: offTicket.body?.key, phase: "BEFORE", clientEventId: randomUUID() });
    check("attach: a key signed for another job is 404", crossJob.status === 404, crossJob.body);
    const offAttach = await post(`${J(jobs.off)}/photos`, cookie, { key: offTicket.body?.key, phase: "AFTER", clientEventId: randomUUID() });
    check("attach: photos off → 409 PHOTOS_OFF", offAttach.status === 409 && offAttach.body?.error?.code === "PHOTOS_OFF", offAttach.body);
    const badPhase = await post(`${J(jobs.main)}/photos`, cookie, { key: never.body?.key, phase: "ISSUE", clientEventId: randomUUID() });
    check("attach: phase ISSUE is 400 (issue photos go through a report)", badPhase.status === 400, badPhase.body);
    const notMine = await post(`${J(jobs.teammates)}/photos`, cookie, { key: never.body?.key, phase: "BEFORE", clientEventId: randomUUID() });
    check("attach: a teammate's job is 404", notMine.status === 404, notMine.body);

    if (realCloudinary) {
      const key = await uploaded(jobs.main, 2);
      check("cloudinary: a signed PNG uploads", !!key);
      const notesBefore = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.photos_uploaded" } });
      const body = { key, phase: "BEFORE", clientEventId: randomUUID() };
      const a = await post(`${J(jobs.main)}/photos`, cookie, body);
      check(
        "attach: 200 with the photo, mine, deletable, on res.cloudinary.com",
        a.status === 200 &&
          a.body?.kind === "BEFORE" &&
          a.body.mine === true &&
          a.body.canDelete === true &&
          a.body.url.startsWith(`https://res.cloudinary.com/${cloud.name}/image/upload/`) &&
          a.body.thumbnailUrl?.includes("/image/upload/c_fill") &&
          a.body.takenBy === "Cleaner",
        a.body,
      );
      const again = await post(`${J(jobs.main)}/photos`, cookie, body);
      const rows = await db.jobPhoto.count({ where: { jobId: jobs.main } });
      check("attach: a replay returns the same photo and adds no row", again.headers["idempotent-replayed"] === "true" && again.body?.id === a.body?.id && rows === 1, { rows });
      const reuse = await post(`${J(jobs.main)}/photos`, cookie, { ...body, clientEventId: randomUUID() });
      check("attach: the same key again is 409 UPLOAD_USED", reuse.status === 409 && reuse.body?.error?.code === "UPLOAD_USED", reuse.body);
      let notesAfter = notesBefore;
      for (let i = 0; i < 20 && notesAfter === notesBefore; i++) {
        await sleep(500);
        notesAfter = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.photos_uploaded" } });
      }
      check("attach: the first photo tells the office once", notesAfter === notesBefore + 1, { notesBefore, notesAfter });
      const second = await uploaded(jobs.main, 3);
      const b = await post(`${J(jobs.main)}/photos`, cookie, { key: second, phase: "AFTER", clientEventId: randomUUID() });
      await sleep(3000);
      const notesThird = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.photos_uploaded" } });
      check("attach: the second photo tells no one", b.status === 200 && notesThird === notesAfter, { b: b.status, notesThird });
      const stored = await db.jobPhoto.findFirst({ where: { id: a.body?.id } });
      check("attach: stored as the web stores it (secure_url, this cleaner, BEFORE)", stored?.url === a.body?.url && stored?.employeeId === F.users.cleaner.id && stored?.kind === "BEFORE", stored);

      // Someone else's photos on the same job.
      const mate = await db.jobPhoto.create({
        data: { organizationId: orgA, jobId: jobs.main, employeeId: F.users.teammate.id, url: `https://res.cloudinary.com/${cloud.name}/image/upload/v1/${testFolder}mate.jpg`, kind: "AFTER" },
      });
      const booking = await db.jobPhoto.create({
        data: { organizationId: orgA, jobId: jobs.main, employeeId: null, url: `https://res.cloudinary.com/${cloud.name}/image/upload/v1/${testFolder}booking.jpg`, kind: "GENERAL" },
      });
      await db.jobPhoto.create({
        data: { organizationId: orgA, jobId: jobs.main, employeeId: F.users.teammate.id, url: "http://example.test/not-ours.jpg", kind: "GENERAL" },
      });
      const l = await call("GET", host, `${J(jobs.main)}/photos`, { cookie });
      const byId = new Map((l.body?.items ?? []).map((p: any) => [p.id, p]));
      const m: any = byId.get(mate.id);
      const bk: any = byId.get(booking.id);
      check(
        "photos: newest first; a teammate's is theirs (first name only), a booking photo is nobody's",
        l.body?.items?.[0]?.id === booking.id && m?.mine === false && m?.canDelete === false && m?.takenBy === "Teammate" && bk?.takenBy === null && bk?.canDelete === false,
        l.body?.items,
      );
      check("photos: a URL not on res.cloudinary.com is never sent", l.body?.total === 4 && l.body.items.every((p: any) => p.url.startsWith("https://res.cloudinary.com/")), l.body?.total);

      const dMate = await del(`${J(jobs.main)}/photos/${mate.id}`, cookie);
      check("delete: a teammate's photo is 404", dMate.status === 404, dMate.body);
      const dBooking = await del(`${J(jobs.main)}/photos/${booking.id}`, cookie);
      check("delete: a client's booking photo is 404", dBooking.status === 404, dBooking.body);
      const dWrongJob = await del(`${J(jobs.off)}/photos/${a.body?.id}`, cookie);
      check("delete: my photo under another job's path is 404", dWrongJob.status === 404, dWrongJob.body);
      const dOwner = await del(`${J(jobs.main)}/photos/${a.body?.id}`, owner);
      check("delete: an OWNER on the crew route is 403", dOwner.status === 403, dOwner.body);
      const noBody = await call("DELETE", host, `${J(jobs.main)}/photos/${a.body?.id}`, { cookie });
      check("delete: without a JSON body the CSRF gate still refuses (415)", noBody.status === 415, noBody.status);
      const d = await del(`${J(jobs.main)}/photos/${a.body?.id}`, cookie);
      check("delete: my own photo goes", d.status === 200 && d.body?.id === a.body?.id, d.body);
      const d2 = await del(`${J(jobs.main)}/photos/${a.body?.id}`, cookie);
      check("delete: a second delete is 404", d2.status === 404, d2.body);
      let gone = false;
      for (let i = 0; i < 20 && !gone; i++) {
        await sleep(500);
        gone = await cloudinary.api.resource(key!, { resource_type: "image" }).then(
          () => false,
          (e: any) => (e?.error?.http_code ?? e?.http_code) === 404,
        );
      }
      check("delete: the Cloudinary asset is destroyed too", gone);
    } else {
      skip("attach happy path, replay, UPLOAD_USED, first-photo email, delete");
    }

    // The cap, and paging.
    const now = Date.now();
    await db.jobPhoto.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({
        organizationId: orgA,
        jobId: jobs.cap,
        employeeId: F.users.teammate.id,
        url: `https://res.cloudinary.com/demo/image/upload/v1/${testFolder}cap-${i}.jpg`,
        kind: "AFTER" as const,
        createdAt: new Date(now - i * 1000),
      })),
    });
    const lastPlace = await ticket(jobs.cap);
    check("cap: at 199 a ticket is still given", lastPlace.status === 200, lastPlace.body);
    let upKey: string | null = null;
    if (realCloudinary) upKey = (await sendToCloudinary(lastPlace.body, pngImage(4))).status === 200 ? lastPlace.body.key : null;
    await db.jobPhoto.create({
      data: { organizationId: orgA, jobId: jobs.cap, employeeId: F.users.teammate.id, url: `https://res.cloudinary.com/demo/image/upload/v1/${testFolder}cap-last.jpg`, kind: "AFTER" },
    });
    const full = await ticket(jobs.cap);
    check("cap: at 200 a ticket is 409 PHOTO_LIMIT_REACHED, and says so", full.status === 409 && full.body?.error?.code === "PHOTO_LIMIT_REACHED" && /200/.test(full.body.error.message), full.body);
    if (realCloudinary && upKey) {
      const late = await post(`${J(jobs.cap)}/photos`, cookie, { key: upKey, phase: "AFTER", clientEventId: randomUUID() });
      const count = await db.jobPhoto.count({ where: { jobId: jobs.cap } });
      check("cap: re-checked at attach time, in the transaction", late.status === 409 && late.body?.error?.code === "PHOTO_LIMIT_REACHED" && count === 200, { late: late.body, count });
    } else skip("cap: re-checked at attach time");
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let firstPage: Res | null = null;
    do {
      const p: Res = await call("GET", host, `${J(jobs.cap)}/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cookie });
      if (!firstPage) firstPage = p;
      for (const it of p.body?.items ?? []) seen.add(it.id);
      cursor = p.body?.nextCursor ?? null;
      pages++;
    } while (cursor && pages < 20);
    check("photos: pages of 30 cover all 200 once", seen.size === 200 && pages === 7 && firstPage?.body?.items?.length === 30, { seen: seen.size, pages });
    check("photos: a full job says canAdd false, 200 of 200", firstPage?.body?.policy?.canAdd === false && firstPage.body.total === 200, firstPage?.body?.policy);
  }

  // ── Issues ─────────────────────────────────────────────────────────────
  {
    const base = { category: "ACCESS", urgency: "URGENT", note: "  Locked out, lockbox empty.  " };
    const body = { ...base, clientEventId: randomUUID() };
    const notesBefore = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.issue_reported" } });
    const r = await post(`${J(jobs.main)}/issues`, cookie, body);
    check(
      "issues: 200 with the report, note trimmed",
      r.status === 200 && r.body?.category === "ACCESS" && r.body.urgency === "URGENT" && r.body.status === "OPEN" && r.body.note === "Locked out, lockbox empty." && r.body.hasPhoto === false && r.body.resolutionNote === null,
      r.body,
    );
    const again = await post(`${J(jobs.main)}/issues`, cookie, body);
    const rows = await db.jobIssue.count({ where: { jobId: jobs.main } });
    check("issues: a replay files nothing new", again.headers["idempotent-replayed"] === "true" && again.body?.id === r.body?.id && rows === 1, { rows });
    const log = await db.jobLog.count({ where: { jobId: jobs.main, field: "issue" } });
    check("issues: one job-log line", log === 1, log);
    let notesAfter = notesBefore;
    for (let i = 0; i < 20 && notesAfter === notesBefore; i++) {
      await sleep(500);
      notesAfter = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.issue_reported" } });
    }
    await sleep(1500);
    notesAfter = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.issue_reported" } });
    check("issues: the office is told once (URGENT at once), not again on the replay", notesAfter === notesBefore + 1, { notesBefore, notesAfter });

    const empty = await post(`${J(jobs.main)}/issues`, cookie, { ...base, note: "   ", clientEventId: randomUUID() });
    check("issues: an empty note is 400", empty.status === 400, empty.body);
    const long = await post(`${J(jobs.main)}/issues`, cookie, { ...base, note: "x".repeat(2001), clientEventId: randomUUID() });
    check("issues: a note over 2000 is 400", long.status === 400, long.body);
    const cat = await post(`${J(jobs.main)}/issues`, cookie, { ...base, category: "WEATHER", clientEventId: randomUUID() });
    check("issues: an unknown category is 400", cat.status === 400, cat.body);
    const theirs = await post(`${J(jobs.teammates)}/issues`, cookie, { ...base, clientEventId: randomUUID() });
    check("issues: a teammate's job is 404", theirs.status === 404, theirs.body);
    const other = await post(`${J(jobs.otherCompany)}/issues`, cookie, { ...base, clientEventId: randomUUID() });
    check("issues: another company's job is 404", other.status === 404, other.body);
    const role = await post(`${J(jobs.main)}/issues`, owner, { ...base, clientEventId: randomUUID() });
    check("issues: an OWNER on the crew route is 403", role.status === 403, role.body);

    const neverSent = await ticket(jobs.main);
    const issuesBefore = await db.jobIssue.count({ where: { jobId: jobs.main } });
    if (realCloudinary) {
      const missing = await post(`${J(jobs.main)}/issues`, cookie, { ...base, photoKey: neverSent.body?.key, clientEventId: randomUUID() });
      check("issues: a photo key never uploaded is 409 UPLOAD_MISSING, and no report is filed", missing.status === 409 && missing.body?.error?.code === "UPLOAD_MISSING" && (await db.jobIssue.count({ where: { jobId: jobs.main } })) === issuesBefore, missing.body);
      // On the job with photos OFF: an ISSUE photo is exempt from the switch.
      const key = await uploaded(jobs.off, 5);
      const withPhoto = await post(`${J(jobs.off)}/issues`, cookie, { ...base, urgency: "NORMAL", category: "PROPERTY", photoKey: key, clientEventId: randomUUID() });
      const photo = await db.jobPhoto.findFirst({ where: { jobId: jobs.off } });
      const issue = await db.jobIssue.findFirst({ where: { id: withPhoto.body?.id } });
      check(
        "issues: a photo attaches as an ISSUE photo with the report, photos switch or not",
        withPhoto.status === 200 && withPhoto.body?.hasPhoto === true && photo?.kind === "ISSUE" && issue?.photoId === photo.id && issue?.photoUrl === photo.url,
        { body: withPhoto.body, photo, issue },
      );
      await sleep(2000);
      const photoMails = await db.notification.count({ where: { organizationId: orgA, notificationKey: "admin.job.photos_uploaded", href: `/admin/jobs/${jobs.off}` } });
      check("issues: an ISSUE photo sends no 'photos added'", photoMails === 0, photoMails);
      const offIssues = await db.jobIssue.count({ where: { jobId: jobs.off } });
      const reused = await post(`${J(jobs.off)}/issues`, cookie, { ...base, photoKey: key, clientEventId: randomUUID() });
      check(
        "issues: a used photo key is 409 UPLOAD_USED and files nothing",
        reused.status === 409 && reused.body?.error?.code === "UPLOAD_USED" && (await db.jobIssue.count({ where: { jobId: jobs.off } })) === offIssues,
        reused.body,
      );
    } else skip("issues with a photo");
    const foreignKey = await post(`${J(jobs.main)}/issues`, cookie, { ...base, photoKey: `${testFolder}jobs/${jobs.main}/${F.users.teammate.id}/${"a".repeat(32)}`, clientEventId: randomUUID() });
    check("issues: a photo key under someone else's prefix is 404", foreignKey.status === 404, foreignKey.body);

    // Listing: mine only; the office's answer once resolved.
    await db.jobIssue.create({ data: { organizationId: orgA, jobId: jobs.main, reportedById: F.users.teammate.id, reportedByName: "Teammate", category: "OTHER", description: "teammate's own" } });
    const resolved = await db.jobIssue.create({
      data: { organizationId: orgA, jobId: jobs.main, reportedById: F.users.cleaner.id, reportedByName: "Cleaner", category: "SUPPLIES", description: "out of cloths", status: "RESOLVED", resolutionNote: "Dropped a pack at the door." },
    });
    const list = await call("GET", host, `${J(jobs.main)}/issues`, { cookie });
    const items = list.body?.items ?? [];
    check("issues: lists only my own reports, newest first", list.status === 200 && items.length === 2 && items[0].id === resolved.id && items.every((i: any) => i.note !== "teammate's own"), items);
    check("issues: a resolved report carries the office's answer", items[0]?.resolutionNote === "Dropped a pack at the door." && items[0]?.status === "RESOLVED", items[0]);
    const listTheirs = await call("GET", host, `${J(jobs.teammates)}/issues`, { cookie });
    check("issues: listing a teammate's job is 404", listTheirs.status === 404, listTheirs.body);

    // 10 an hour, and a replay isn't counted.
    let limited: Res | null = null;
    for (let i = 0; i < 12 && !limited; i++) {
      const x = await post(`${J(jobs.main)}/issues`, cookie, { ...base, urgency: "NORMAL", clientEventId: randomUUID() });
      if (x.status === 429) limited = x;
    }
    check("issues: the 11th report in an hour is 429", limited?.body?.error?.code === "RATE_LIMITED", limited?.body);
    const replayAfter = await post(`${J(jobs.main)}/issues`, cookie, body);
    check("issues: a replay still answers after the limit", replayAfter.status === 200 && replayAfter.headers["idempotent-replayed"] === "true", replayAfter.status);
  }

  // ── On my way ──────────────────────────────────────────────────────────
  {
    const coords = { lat: 43.65, lng: -79.38, accuracyM: 12 };
    const st = await call("GET", host, `${J(jobs.main)}/on-my-way`, { cookie });
    check("on-my-way: nothing sent yet; GPS off → don't ask for location", st.status === 200 && st.body?.sentAt === null && st.body.askForLocation === false, st.body);
    const body = { coords, clientEventId: randomUUID() };
    const r = await post(`${J(jobs.main)}/on-my-way`, cookie, body);
    const row = await db.job.findFirst({ where: { id: jobs.main }, select: { onMyWayAt: true, onMyWayLat: true } });
    check(
      "on-my-way: sent; no client on file so no text; GPS off so the position is dropped",
      r.status === 200 && r.body?.alreadySent === false && r.body.clientTold === false && r.body.locationSaved === false && !!row?.onMyWayAt && row.onMyWayLat === null,
      { body: r.body, row },
    );
    const replay = await post(`${J(jobs.main)}/on-my-way`, cookie, body);
    check("on-my-way: a replay returns the same answer", replay.headers["idempotent-replayed"] === "true" && replay.body?.sentAt === r.body?.sentAt, replay.body);
    const second = await post(`${J(jobs.main)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    check("on-my-way: a second tap returns the first sentAt, alreadySent, tells no one", second.status === 200 && second.body?.alreadySent === true && second.body.sentAt === r.body?.sentAt && second.body.officeTold === false && second.body.clientTold === false, second.body);
    const logs = await db.jobLog.count({ where: { jobId: jobs.main, description: { contains: "is on the way" } } });
    check("on-my-way: one timeline line", logs === 1, logs);
    const st2 = await call("GET", host, `${J(jobs.main)}/on-my-way`, { cookie });
    check("on-my-way: the state shows when I said so", st2.body?.sentAt === r.body?.sentAt, st2.body);

    const tomorrow = await post(`${J(jobs.tomorrow)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    check("on-my-way: a job tomorrow is 409 NOT_TODAY", tomorrow.status === 409 && tomorrow.body?.error?.code === "NOT_TODAY", tomorrow.body);
    const paid = await post(`${J(jobs.paid)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    check("on-my-way: a finished job is 409 JOB_CLOSED", paid.status === 409 && paid.body?.error?.code === "JOB_CLOSED", paid.body);
    await db.jobWorkSession.create({ data: { organizationId: orgA, jobId: jobs.started, cleanerId: F.users.cleaner.id, startedAt: new Date() } });
    const started = await post(`${J(jobs.started)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    check("on-my-way: after clocking in is 409 ALREADY_STARTED", started.status === 409 && started.body?.error?.code === "ALREADY_STARTED", started.body);
    const theirs = await post(`${J(jobs.teammates)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    check("on-my-way: a teammate's job is 404", theirs.status === 404, theirs.body);
    const theirsGet = await call("GET", host, `${J(jobs.otherCompany)}/on-my-way`, { cookie });
    check("on-my-way: another company's job is 404", theirsGet.status === 404, theirsGet.body);
    const bad = await post(`${J(jobs.gps)}/on-my-way`, cookie, { coords: { lat: 91, lng: 0, accuracyM: 1 }, clientEventId: randomUUID() });
    check("on-my-way: an impossible latitude is 400", bad.status === 400, bad.body);
    const role = await post(`${J(jobs.main)}/on-my-way`, applicant, { clientEventId: randomUUID() });
    check("on-my-way: an APPLICANT is 403", role.status === 403, role.body);

    // A teammate said so first: I'm recorded, nobody is told twice.
    const mate = await post(`${J(jobs.shared)}/on-my-way`, teammate, { clientEventId: randomUUID() });
    const me = await post(`${J(jobs.shared)}/on-my-way`, cookie, { clientEventId: randomUUID() });
    const mine = await db.jobAssignment.findFirst({ where: { jobId: jobs.shared, cleanerId: F.users.cleaner.id } });
    const sharedLogs = await db.jobLog.count({ where: { jobId: jobs.shared, description: { contains: "is on the way" } } });
    check(
      "on-my-way: after a teammate, mine is recorded but the office and client aren't told again",
      mate.status === 200 && me.status === 200 && me.body?.alreadySent === false && me.body.officeTold === false && me.body.clientTold === false && !!mine?.onMyWayAt && sharedLogs === 1,
      { mate: mate.body, me: me.body, sharedLogs },
    );

    // GPS on: the position is kept.
    await db.appSetting.updateMany({ where: { organizationId: orgA, key: "tracking.gpsEnabled" }, data: { value: true } });
    await sleep(31_000); // the settings cache
    const st3 = await call("GET", host, `${J(jobs.gps)}/on-my-way`, { cookie });
    const g = await post(`${J(jobs.gps)}/on-my-way`, cookie, { coords, clientEventId: randomUUID() });
    const gRow = await db.job.findFirst({ where: { id: jobs.gps }, select: { onMyWayLat: true, onMyWayLng: true } });
    check("on-my-way: GPS on → askForLocation, and the position is kept", st3.body?.askForLocation === true && g.body?.locationSaved === true && gRow?.onMyWayLat === 43.65 && gRow?.onMyWayLng === -79.38, { st: st3.body, g: g.body, gRow });
  }

  // ── Announcements ──────────────────────────────────────────────────────
  {
    const t0 = new Date(Date.now() - 5 * 3600_000);
    const mk = (data: { title: string; pinned?: boolean; createdAt: Date; updatedAt?: Date; organizationId?: string }) =>
      db.announcement.create({
        data: { organizationId: data.organizationId ?? orgA, title: data.title, body: `${data.title} body`, pinned: data.pinned ?? false, authorName: "Office", createdAt: data.createdAt, updatedAt: data.updatedAt ?? data.createdAt },
        select: { id: true },
      });
    const pinnedOld = await mk({ title: "Pinned old", pinned: true, createdAt: new Date(t0.getTime() - 3600_000) });
    const pinnedNew = await mk({ title: "Pinned new", pinned: true, createdAt: t0 });
    const edited = await mk({ title: "Edited", createdAt: new Date(t0.getTime() + 60_000), updatedAt: new Date(t0.getTime() + 2 * 3600_000) });
    const plain: string[] = [];
    for (let i = 0; i < 21; i++) plain.push((await mk({ title: `Note ${i}`, createdAt: new Date(t0.getTime() + 120_000 + i * 60_000) })).id);
    const otherCo = await db.announcement.create({ data: { organizationId: F.orgB.id, title: "Other company", body: "x", authorName: "B" }, select: { id: true } });
    await db.announcementReaction.create({ data: { organizationId: orgA, announcementId: plain[20], userId: F.users.teammate.id, emoji: "👍" } });
    await db.announcementRead.create({ data: { organizationId: orgA, announcementId: pinnedOld.id, userId: F.users.teammate.id } });
    // My read of "Edited" predates its edit; my read of "Pinned new" is old and fine.
    const staleAt = new Date(t0.getTime() + 30 * 60_000);
    await db.announcementRead.create({ data: { organizationId: orgA, announcementId: edited.id, userId: F.users.cleaner.id, readAt: staleAt } });
    const firstSeen = new Date(t0.getTime() + 10 * 60_000);
    await db.announcementRead.create({ data: { organizationId: orgA, announcementId: pinnedNew.id, userId: F.users.cleaner.id, readAt: firstSeen } });
    const total = 24;

    const readsBefore = await db.announcementRead.count({ where: { userId: F.users.cleaner.id } });
    const p1 = await call("GET", host, "/api/v1/announcements", { cookie });
    const p2 = p1.body?.nextCursor ? await call("GET", host, `/api/v1/announcements?cursor=${encodeURIComponent(p1.body.nextCursor)}`, { cookie }) : null;
    const all = [...(p1.body?.items ?? []), ...(p2?.body?.items ?? [])];
    check(
      "announcements: pinned first (newest first within), then newest, across pages, each once",
      p1.status === 200 && p1.body.items.length === 20 && all.length === total && new Set(all.map((a: any) => a.id)).size === total &&
        all[0].id === pinnedNew.id && all[1].id === pinnedOld.id && all[2].id === plain[20] && all[total - 1].id === edited.id && p2?.body?.nextCursor === null,
      all.map((a: any) => a.title),
    );
    check("announcements: never another company's", !all.some((a: any) => a.id === otherCo.id));
    check("announcements: unreadCount counts what I never opened", p1.body?.unreadCount === total - 2, p1.body?.unreadCount);
    check(
      "announcements: no register — no audience, no read counts",
      !/audience|readCount|staleReadCount/.test(p1.text + (p2?.text ?? "")),
    );
    const n20: any = all.find((a: any) => a.id === plain[20]);
    check("announcements: reactions by name, with mine", JSON.stringify(n20?.reactions) === JSON.stringify([{ kind: "THUMBS_UP", count: 1 }]) && n20.myReaction === null, n20);
    const ed: any = all.find((a: any) => a.id === edited.id);
    check("announcements: an edit shows editedAt, and my older read as stale but read", !!ed?.editedAt && ed.readByMe === true && ed.myReadStale === true, ed);
    check("announcements: reading the list marks nothing", (await db.announcementRead.count({ where: { userId: F.users.cleaner.id } })) === readsBefore);
    const asOwner = await call("GET", host, "/api/v1/announcements", { cookie: owner });
    check("announcements: an OWNER reads them too (every staff role)", asOwner.status === 200, asOwner.body);
    const asApplicant = await call("GET", host, "/api/v1/announcements", { cookie: applicant });
    check("announcements: an APPLICANT is 403", asApplicant.status === 403, asApplicant.body);

    const mark = await post("/api/v1/announcements/read", cookie, { ids: [pinnedOld.id, pinnedNew.id, edited.id, otherCo.id, "no-such-id"] });
    const reads = await db.announcementRead.findMany({ where: { userId: F.users.cleaner.id }, select: { announcementId: true, readAt: true } });
    const readOf = (id: string) => reads.find((r) => r.announcementId === id)?.readAt;
    check("read: new reads written, unknown and other-company ids ignored", mark.status === 200 && mark.body?.marked === 1 && mark.body.unreadCount === total - 3, mark.body);
    check("read: never a row for another company's announcement", (await db.announcementRead.count({ where: { announcementId: otherCo.id } })) === 0);
    check("read: an existing read isn't moved", readOf(pinnedNew.id)?.getTime() === firstSeen.getTime(), readOf(pinnedNew.id));
    check("read: a read from before the edit is re-stamped", (readOf(edited.id)?.getTime() ?? 0) > staleAt.getTime() + 60_000, readOf(edited.id));
    const tooMany = await post("/api/v1/announcements/read", cookie, { ids: Array.from({ length: 201 }, (_, i) => `id${i}`) });
    check("read: more than 200 ids is 400", tooMany.status === 400, tooMany.body);
    const none = await post("/api/v1/announcements/read", cookie, { ids: [] });
    check("read: no ids is 400", none.status === 400, none.body);

    const reactPath = `/api/v1/announcements/${plain[20]}/reactions`;
    const thumbs = { kind: "THUMBS_UP", clientEventId: randomUUID() };
    const r1 = await post(reactPath, cookie, thumbs);
    check("react: set THUMBS_UP", r1.status === 200 && r1.body?.myReaction === "THUMBS_UP" && r1.body.reactions?.[0]?.count === 2, r1.body);
    const r1b = await post(reactPath, cookie, thumbs);
    check("react: a replay is the stored answer", r1b.headers["idempotent-replayed"] === "true" && JSON.stringify(r1b.body) === JSON.stringify(r1.body));
    const r2 = await post(reactPath, cookie, { kind: "THUMBS_UP", clientEventId: randomUUID() });
    check("react: setting the same kind again keeps it (a set, not a toggle)", r2.body?.myReaction === "THUMBS_UP" && r2.body.reactions?.[0]?.count === 2, r2.body);
    const r3 = await post(reactPath, cookie, { kind: "HEART", clientEventId: randomUUID() });
    check("react: HEART replaces it, one per person", r3.body?.myReaction === "HEART" && JSON.stringify(r3.body.reactions) === JSON.stringify([{ kind: "THUMBS_UP", count: 1 }, { kind: "HEART", count: 1 }]), r3.body);
    const r4 = await post(reactPath, cookie, { kind: null, clientEventId: randomUUID() });
    check("react: null removes mine only", r4.body?.myReaction === null && JSON.stringify(r4.body.reactions) === JSON.stringify([{ kind: "THUMBS_UP", count: 1 }]), r4.body);
    const r5 = await post(`/api/v1/announcements/${otherCo.id}/reactions`, cookie, { kind: "PARTY", clientEventId: randomUUID() });
    check("react: another company's announcement is 404", r5.status === 404, r5.body);
    const r6 = await post("/api/v1/announcements/nope/reactions", cookie, { kind: "PARTY", clientEventId: randomUUID() });
    check("react: an unknown announcement is 404", r6.status === 404, r6.body);
    const r7 = await post(reactPath, cookie, { kind: "ANGRY", clientEventId: randomUUID() });
    check("react: an unknown kind is 400", r7.status === 400, r7.body);
    const theirs = await db.announcementReaction.findFirst({ where: { announcementId: plain[20], userId: F.users.teammate.id } });
    check("react: a teammate's reaction is never touched", theirs?.emoji === "👍", theirs);
  }

  // ── Cloudinary cleanup: only the throwaway company's folder ────────────
  if (realCloudinary) {
    try {
      await cloudinary.api.delete_resources_by_prefix(testFolder, { resource_type: "image" });
      console.log(`cloudinary: cleared ${testFolder}`);
    } catch (e) {
      console.error("cloudinary cleanup failed:", (e as any)?.error?.message ?? e);
    }
  }
}
