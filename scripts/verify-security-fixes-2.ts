// Verification for security batch 2: who may decide hours, withdrawals, kit
// requests and office chat, and who may be put on a crew.
//
// Run: npx tsx --conditions=react-server scripts/verify-security-fixes-2.ts
//      … --staging --port 3108   (adds the end-to-end run, see below)
//
// Two halves, matching the other verify-* scripts:
//
//   1. A SOURCE SWEEP (always). The structural guarantees, each one a line
//      that a later edit could quietly remove: the self-refusals, the
//      conditional updates that stop two deciders both applying, and the
//      OWNER/ADMIN gate on the office chat. Code-only, so it runs in
//      `npm run verify` with no database.
//
//   2. END TO END, against STAGING ONLY (opt-in with --staging). It needs a
//      `next start` of this build on --port, connected to the staging
//      database. It signs in throwaway users and calls the server actions over
//      HTTP, the way a hand-made request would. Every action is posted to the
//      public /sign-in page: the action runs the same from any page, and a
//      signed-in admin page re-renders its whole dashboard on every
//      revalidating action, which is minutes per call against a remote pooler.
//      It refuses to run unless STAGING_DATABASE_URL names the staging ref
//      udgbixmlyqsoalvrjbgo (and not production's). It sweeps anything left by
//      an earlier, interrupted run before it starts, and everything it made
//      when it ends.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  — ${detail.slice(0, 240)}` : ""}`);
};

/* ═══════════════════════════ 1. source sweep ═══════════════════════════ */

const src = (p: string) => {
  const f = path.join(process.cwd(), p);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
};

console.log("\n── Source sweep");
{
  const decide = src("src/app/admin/actions/decideTimeLogChange.ts");
  check("decideTimeLogChange refuses the requester's own request",
    /req\.cleanerId === session\.user\.id/.test(decide));
  check("decideTimeLogChange scopes a Field Lead to their group",
    /role === "FIELD_LEAD"[\s\S]{0,80}isFieldLeadGroupMember/.test(decide));
  check("decideTimeLogChange claims the decision with a conditional updateMany",
    /timeLogChangeRequest\.updateMany\(\{\s*where: \{ id: req\.id, status: \{ in:/.test(decide));
  check("countPendingTimeLogRequests checks the session",
    /countPendingTimeLogRequests[\s\S]{0,400}getSession/.test(decide));

  const uct = src("src/app/admin/actions/updateClockTimes.ts");
  check("updateClockTimes does not admit FIELD_LEAD",
    /CLOCK_EDIT_ROLES = \["OWNER", "ADMIN", "OPS_MANAGER"\]/.test(uct) && !/isAdminRole\(/.test(uct));
  const core = src("src/app/admin/actions/_clockTimes.ts");
  check("the clock-edit core refuses the editor's own entry (session, assignment, job)",
    (core.match(/return OWN_ENTRY/g) ?? []).length >= 3);
  check("the clock-edit core is not a \"use server\" module", core !== "" && !/^"use server"/m.test(core));

  const wd = src("src/app/admin/actions/processWithdrawal.ts");
  check("processWithdrawal refuses the caller's own withdrawal",
    /withdrawal\.employeeId === session\.user\.id/.test(wd));
  check("processWithdrawal moves status with a conditional updateMany",
    /withdrawal\.updateMany\(\{\s*where: \{ id: withdrawalId, status: \{ in:/.test(wd) && !/withdrawal\.update\(\{/.test(wd));

  const inv = src("src/app/admin/actions/resolveInventoryRequest.ts");
  check("resolveInventoryRequest refuses the caller's own request",
    /request\.employeeId === session\.user\.id/.test(inv));
  check("resolveInventoryRequest never updates a request unconditionally",
    !/inventoryRequest\.update\(\{/.test(inv) &&
      (inv.match(/inventoryRequest\.updateMany\(\{\s*where: \{ id: requestId, status: "PENDING" \}/g) ?? []).length === 3);

  const chat = src("src/app/admin/chat/actions.ts");
  check("office chat treats only OWNER/ADMIN as the office",
    /const isOfficeRole = isOwnerAdminRole/.test(chat) && !/isAdminRole/.test(chat.replace(/\/\/.*$/gm, "")));
  check("office chat refuses non-staff (no EMPLOYEE default for a missing role)",
    /isStaffRole\(user\.role\)/.test(chat) && !/\?\? "EMPLOYEE"/.test(chat));
  const unread = src("src/lib/chatUnread.ts");
  check("the office unread badge is OWNER/ADMIN only", /isOwnerAdminRole\(user\.role\)/.test(unread));

  const assign = src("src/app/admin/actions/assignCleaners.ts");
  const bulk = src("src/app/admin/actions/bulkAssignCleaner.ts");
  check("assignCleaners checks the people it adds", /unassignableCrewIds\(newlyAdded\)/.test(assign));
  check("bulkAssignCleaner requires an active, unarchived crew member", /ASSIGNABLE_CREW_WHERE/.test(bulk));
  const ja = src("src/lib/job-assignments.ts");
  check("the assignable-crew rule includes isActive and deletedAt",
    /ASSIGNABLE_CREW_WHERE = \{[\s\S]{0,160}isActive: true,[\s\S]{0,40}deletedAt: null/.test(ja));

  const gc = src("src/app/cleaners/group-chat/groupChat.ts");
  check("deleting a team chat message logs who did it",
    /action: "groupchat\.message\.deleted"[\s\S]{0,80}actorId: a\.user\.id/.test(gc));
}

/* ═══════════════════════════ 2. end to end ═══════════════════════════ */

type R = { success?: boolean; error?: string; data?: unknown; raw?: string; status?: number } | number | null;

async function e2e() {
  const STAGING = process.env.STAGING_DATABASE_URL ?? "";
  if (!STAGING.includes("udgbixmlyqsoalvrjbgo") || STAGING.includes("kbreldosgjzwqnwnvxgw")) {
    console.error("ABORT: STAGING_DATABASE_URL is not the staging project (udgbixmlyqsoalvrjbgo).");
    process.exit(1);
  }
  console.log("\nDB project ref: udgbixmlyqsoalvrjbgo");

  const { PrismaClient } = await import("@prisma/client");
  const { hashPassword } = await import("better-auth/crypto");
  const db = new PrismaClient({ datasourceUrl: STAGING });

  const portArg = process.argv.indexOf("--port");
  const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : 3108);
  const TENANT = "teamcleano-demo";
  const host = `${TENANT}.localhost`;
  const origin = `http://${host}:${PORT}`;
  const PAGE = "/sign-in";
  const PASSWORD = "Sec2-E2E-" + Math.random().toString(36).slice(2, 10);
  const tag = Date.now().toString(36);
  const PREFIX = "sec2-e2e-";
  const NAME = "Sec2 E2E";

  const rnd = () => Math.floor(Math.random() * 250);
  const request = (p: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: PORT, path: p, method: opts.method ?? "GET", headers: { host: `${host}:${PORT}`, ...(opts.headers ?? {}) } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
        },
      );
      req.setTimeout(180_000, () => req.destroy(new Error("request timed out")));
      req.on("error", reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });

  async function signIn(email: string) {
    const res = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-forwarded-for": `10.${rnd()}.${rnd()}.${rnd()}` },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0]).filter((c) => c.includes("session_token")).join("; ");
    if (!cookie) throw new Error(`sign-in failed (${res.status})`);
    return cookie;
  }

  const manifest = JSON.parse(fs.readFileSync(".next/server/server-reference-manifest.json", "utf8"));
  const actions: Record<string, { exportedName?: string }> = { ...manifest.node, ...manifest.edge };
  const actionId = (name: string) => Object.entries(actions).find(([, v]) => v.exportedName === name)?.[0];

  async function call(cookie: string, name: string, args: unknown[]): Promise<R> {
    const id = actionId(name);
    if (!id) return { raw: `no action id for ${name} in this build` };
    const res = await request(PAGE, {
      method: "POST",
      headers: {
        "next-action": id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component",
        origin, "x-forwarded-for": `10.200.${rnd()}.${rnd()}`, ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(args),
    });
    const line = res.body.split("\n").find((l) => l.startsWith("1:"));
    if (line) {
      try { return JSON.parse(line.slice(2)); } catch { /* fall through */ }
    }
    return { raw: res.body.slice(-240), status: res.status };
  }
  const ok = (r: R) => !!r && typeof r === "object" && r.success === true;
  const said = (r: R, re: RegExp) => !!r && typeof r === "object" && typeof r.error === "string" && re.test(r.error);
  const show = (r: unknown) => JSON.stringify(r)?.slice(0, 200) ?? "";

  const org = await db.organization.findUnique({ where: { slug: TENANT }, select: { id: true } });
  if (!org) throw new Error("staging tenant missing");
  const orgId = org.id;

  /** Removes every row any run of this script made. Safe to repeat. */
  async function sweep() {
    const tryDel = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { console.log(`cleanup ${label}: ${String((e as Error).message).split("\n").pop()}`); }
    };
    const us = (await db.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id);
    const jobs = (await db.job.findMany({ where: { clientName: { startsWith: NAME } }, select: { id: true } })).map((j) => j.id);
    const products = (await db.product.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } })).map((p) => p.id);
    const channels = (await db.groupChannel.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } })).map((c) => c.id);
    const convs = (await db.chatConversation.findMany({ where: { employeeId: { in: us } }, select: { id: true } })).map((c) => c.id);
    if (jobs.length) {
      await tryDel("requests", () => db.timeLogChangeRequest.deleteMany({ where: { jobId: { in: jobs } } }));
      await tryDel("alerts", () => db.alert.deleteMany({ where: { relatedId: { in: jobs } } }));
      await tryDel("jobLog", () => db.jobLog.deleteMany({ where: { jobId: { in: jobs } } }));
      await tryDel("sessions", () => db.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } }));
      await tryDel("assignments", () => db.jobAssignment.deleteMany({ where: { jobId: { in: jobs } } }));
      await tryDel("job activity", () => db.activityLog.deleteMany({ where: { targetId: { in: jobs } } }));
      await tryDel("jobs", () => db.job.deleteMany({ where: { id: { in: jobs } } }));
    }
    if (products.length) {
      await tryDel("invChange", () => db.inventoryChange.deleteMany({ where: { productId: { in: products } } }));
      await tryDel("kit rows", () => db.employeeProduct.deleteMany({ where: { productId: { in: products } } }));
      await tryDel("product requests", () => db.inventoryRequest.deleteMany({ where: { productId: { in: products } } }));
      await tryDel("stock", () => db.inventoryLocationStock.deleteMany({ where: { productId: { in: products } } }));
      await tryDel("products", () => db.product.deleteMany({ where: { id: { in: products } } }));
    }
    await tryDel("locations", () => db.inventoryLocation.deleteMany({ where: { name: { startsWith: NAME } } }));
    if (channels.length) await tryDel("channels", () => db.groupChannel.deleteMany({ where: { id: { in: channels } } }));
    if (us.length) {
      await tryDel("requests", () => db.inventoryRequest.deleteMany({ where: { employeeId: { in: us } } }));
      await tryDel("withdrawals", () => db.withdrawal.deleteMany({ where: { employeeId: { in: us } } }));
      await tryDel("chat msgs", () => db.chatMessage.deleteMany({ where: { OR: [{ conversationId: { in: convs } }, { senderId: { in: us } }] } }));
      await tryDel("chat convs", () => db.chatConversation.deleteMany({ where: { id: { in: convs } } }));
      await tryDel("activity", () => db.activityLog.deleteMany({ where: { actorId: { in: us } } }));
      await tryDel("users", () => db.user.deleteMany({ where: { id: { in: us } } }));
    }
  }

  await sweep();
  // The office inbox backfills a conversation row for every staff member who
  // has none. Those rows are this run's doing too, so they are removed after.
  const convBefore = new Set((await db.chatConversation.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((c) => c.id));
  const hash = await hashPassword(PASSWORD);
  async function makeUser(key: string, role: string, extra: Record<string, unknown> = {}) {
    const u = await db.user.create({
      data: {
        email: `${PREFIX}${key}-${tag}@teamcleano-demo.test`, name: `${NAME} ${key}`, role: role as never,
        organizationId: orgId, emailVerified: true, isActive: true, ...extra,
      },
    });
    await db.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: hash } });
    return u;
  }

  try {
    const owner = await makeUser("owner", "OWNER");
    const admin = await makeUser("admin", "ADMIN");
    const admin2 = await makeUser("admin2", "ADMIN");
    const ops = await makeUser("ops", "OPS_MANAGER");
    const lead = await makeUser("lead", "FIELD_LEAD");
    const mine = await makeUser("mine", "EMPLOYEE", { fieldLeadId: lead.id });
    const theirs = await makeUser("theirs", "EMPLOYEE");
    const off = await makeUser("off", "EMPLOYEE", { isActive: false });
    const extra = await makeUser("extra", "EMPLOYEE");
    const c: Record<string, string> = {};
    for (const [k, u] of Object.entries({ owner, admin, admin2, ops, lead, theirs })) c[k] = await signIn(u.email);

    const day = new Date(Date.now() - 864e5);
    day.setUTCHours(14, 0, 0, 0);
    const at = (h: number) => new Date(day.getTime() + h * 36e5);
    const job = await db.job.create({
      data: {
        organizationId: orgId, jobNumber: 900000000 + Math.floor(Math.random() * 90000000),
        clientName: `${NAME} test ${tag}`, startTime: day, jobDate: day, employeeId: lead.id,
        cleaners: { connect: [{ id: lead.id }, { id: mine.id }, { id: theirs.id }] },
        notifyClient: false, notifyProvider: false,
      },
    });
    const jobId = job.id;
    async function entry(u: { id: string }) {
      await db.jobAssignment.create({ data: { organizationId: orgId, jobId, cleanerId: u.id, status: "CLOCKED_OUT", clockInTime: at(0), clockOutTime: at(2) } });
      const s = await db.jobWorkSession.create({ data: { organizationId: orgId, jobId, cleanerId: u.id, startedAt: at(0), endedAt: at(2) } });
      const r = await db.timeLogChangeRequest.create({
        data: { organizationId: orgId, jobId, cleanerId: u.id, sessionId: s.id, originalStart: at(0), originalEnd: at(2), requestedEnd: at(3), reason: `${NAME} request` },
      });
      return { session: s, request: r };
    }
    const leadE = await entry(lead);
    const mineE = await entry(mine);
    const theirsE = await entry(theirs);

    console.log("\n── 1. Clock-time decisions");
    // As a cleaner, while three requests are waiting. (Anonymous action posts
    // are answered before any action runs on this server, so a signed-in
    // non-admin is the caller that actually reaches the gate.)
    let r = await call(c.theirs, "countPendingTimeLogRequests", []);
    check("countPendingTimeLogRequests answers 0 to a cleaner while requests wait", r === 0, show(r));
    r = await call(c.lead, "decideTimeLogChange", [{ requestId: leadE.request.id, approve: true }]);
    check("a field lead approving their OWN request is refused", said(r, /own/i), show(r));
    r = await call(c.lead, "decideTimeLogChange", [{ requestId: theirsE.request.id, approve: true }]);
    check("a field lead approving another group's request is refused as not found", said(r, /not found/i), show(r));
    r = await call(c.lead, "updateClockTimes", [{ jobId, sessionId: theirsE.session.id, clockInTime: at(0).toISOString(), clockOutTime: at(5).toISOString() }]);
    check("a field lead editing clock times directly is refused", said(r, /not authorized/i), show(r));
    r = await call(c.lead, "decideTimeLogChange", [{ requestId: mineE.request.id, approve: true }]);
    const mineS = await db.jobWorkSession.findUnique({ where: { id: mineE.session.id } });
    const mineR = await db.timeLogChangeRequest.findUnique({ where: { id: mineE.request.id } });
    check("a field lead approving their own group's request succeeds and moves the clock",
      ok(r) && mineR?.status === "APPROVED" && mineR?.decidedById === lead.id && mineS?.endedAt?.getTime() === at(3).getTime(),
      `${show(r)} status=${mineR?.status}`);
    r = await call(c.admin, "updateClockTimes", [{ jobId, sessionId: theirsE.session.id, clockInTime: at(0).toISOString(), clockOutTime: at(2.5).toISOString() }]);
    check("an admin can still edit a cleaner's clock", ok(r), show(r));
    const adminS = await db.jobWorkSession.create({ data: { organizationId: orgId, jobId, cleanerId: admin.id, startedAt: at(0), endedAt: at(1) } });
    await db.job.update({ where: { id: jobId }, data: { cleaners: { connect: { id: admin.id } } } });
    r = await call(c.admin, "updateClockTimes", [{ jobId, sessionId: adminS.id, clockInTime: at(0).toISOString(), clockOutTime: at(4).toISOString() }]);
    check("an admin editing their OWN session is refused", said(r, /own/i), show(r));
    const [d1, d2] = await Promise.all([
      call(c.admin, "decideTimeLogChange", [{ requestId: theirsE.request.id, approve: true }]),
      call(c.admin2, "decideTimeLogChange", [{ requestId: theirsE.request.id, approve: false }]),
    ]);
    const tR = await db.timeLogChangeRequest.findUnique({ where: { id: theirsE.request.id } });
    const tS = await db.jobWorkSession.findUnique({ where: { id: theirsE.session.id } });
    const won = ok(d1) ? "APPROVED" : ok(d2) ? "REJECTED" : "none";
    const endWanted = won === "APPROVED" ? at(3) : at(2.5);
    check("two admins deciding one request at once: exactly one wins, and the row agrees",
      [d1, d2].filter(ok).length === 1 && tR?.status === won && tS?.endedAt?.getTime() === endWanted.getTime(),
      `${show(d1)} | ${show(d2)} | status=${tR?.status}`);

    console.log("\n── 2. Withdrawals");
    const own = await db.withdrawal.create({ data: { organizationId: orgId, employeeId: admin.id, amount: 1 } });
    r = await call(c.admin, "processWithdrawal", [own.id, "APPROVE", {}]);
    const ownAfter = await db.withdrawal.findUnique({ where: { id: own.id } });
    check("an admin approving their OWN withdrawal is refused", said(r, /own/i) && ownAfter?.status === "PENDING", `${show(r)} status=${ownAfter?.status}`);
    const w = await db.withdrawal.create({ data: { organizationId: orgId, employeeId: theirs.id, amount: 1, status: "APPROVED" } });
    const [w1, w2] = await Promise.all([
      call(c.admin, "processWithdrawal", [w.id, "COMPLETE", {}]),
      call(c.admin2, "processWithdrawal", [w.id, "REJECT", {}]),
    ]);
    const wAfter = await db.withdrawal.findUnique({ where: { id: w.id } });
    const wWon = ok(w1) ? "COMPLETED" : ok(w2) ? "REJECTED" : "none";
    check("COMPLETE and REJECT at once: exactly one wins, and the row agrees",
      [w1, w2].filter(ok).length === 1 && wAfter?.status === wWon, `${show(w1)} | ${show(w2)} | status=${wAfter?.status}`);

    console.log("\n── 3. Office chat");
    r = await call(c.ops, "getAdminChatList", []);
    check("an ops manager opening the office's chat list is refused", said(r, /not authorized/i), show(r));
    r = await call(c.lead, "getAdminChat", [theirs.id]);
    check("a field lead opening a cleaner's office conversation is refused", said(r, /not authorized/i), show(r));
    const tConv = await db.chatConversation.upsert({ where: { employeeId: theirs.id }, update: {}, create: { organizationId: orgId, employeeId: theirs.id } });
    r = await call(c.lead, "sendChatMessage", [tConv.id, `${NAME} lead writing into a cleaner's chat`]);
    check("a field lead replying in a cleaner's office conversation is refused", said(r, /not authorized/i), show(r));
    const leadChat = await call(c.lead, "getEmployeeChat", []);
    const leadConvId = (leadChat as { data?: { conversationId?: string } })?.data?.conversationId;
    r = leadConvId ? await call(c.lead, "sendChatMessage", [leadConvId, `${NAME} lead to the office`]) : leadChat;
    const leadMsgId = (r as { data?: { id?: string } })?.data?.id;
    const leadMsg = leadMsgId ? await db.chatMessage.findUnique({ where: { id: leadMsgId } }) : null;
    check("a field lead can still message the office, as a staff member (EMPLOYEE)",
      ok(r) && leadMsg?.senderRole === "EMPLOYEE", `${show(r)} role=${leadMsg?.senderRole}`);
    const list = await call(c.owner, "getAdminChatList", []);
    const rows = ((list as { data?: { employeeId: string; unreadFromEmployee: number }[] })?.data ?? []);
    const leadRow = rows.find((x) => x.employeeId === lead.id);
    check("…and the office sees it in its inbox, unread", ok(list) && (leadRow?.unreadFromEmployee ?? 0) >= 1, show(leadRow ?? list));
    r = await call(c.theirs, "sendChatMessage", [tConv.id, `${NAME} cleaner to the office`]);
    const cMsgId = (r as { data?: { id?: string } })?.data?.id;
    const cMsg = cMsgId ? await db.chatMessage.findUnique({ where: { id: cMsgId } }) : null;
    check("a cleaner still messages the office as before", ok(r) && cMsg?.senderRole === "EMPLOYEE", show(r));

    console.log("\n── 4. Kit requests");
    const kitOwn = await db.inventoryRequest.create({ data: { organizationId: orgId, employeeId: admin.id, quantity: 1, reason: NAME } });
    r = await call(c.admin, "resolveInventoryRequest", [kitOwn.id, "APPROVED"]);
    check("an admin approving their OWN kit request is refused", said(r, /own/i), show(r));
    const product = await db.product.create({ data: { organizationId: orgId, name: `${NAME} product ${tag}`, unit: "each", costPerUnit: 0, stockLevel: 10 } });
    const loc = await db.inventoryLocation.create({ data: { organizationId: orgId, name: `${NAME} shelf ${tag}` } });
    await db.inventoryLocationStock.create({ data: { organizationId: orgId, locationId: loc.id, productId: product.id, quantity: 10 } });
    const pr = await db.inventoryRequest.create({ data: { organizationId: orgId, employeeId: theirs.id, productId: product.id, quantity: 2, reason: NAME } });
    const [k1, k2] = await Promise.all([
      call(c.admin, "resolveInventoryRequest", [pr.id, "APPROVED"]),
      call(c.admin2, "resolveInventoryRequest", [pr.id, "APPROVED"]),
    ]);
    const pAfter = await db.product.findUnique({ where: { id: product.id } });
    const kit = await db.employeeProduct.findFirst({ where: { employeeId: theirs.id, productId: product.id } });
    check("two admins approving one refill at once: stock moves exactly once",
      [k1, k2].filter(ok).length === 1 && pAfter?.stockLevel === 8 && kit?.quantity === 2,
      `${show(k1)} | ${show(k2)} | stock=${pAfter?.stockLevel} kit=${kit?.quantity}`);

    console.log("\n── 5. Crew assignment");
    const crewNow = [lead.id, mine.id, theirs.id, admin.id];
    r = await call(c.admin, "assignCleaners", [{ jobId, cleanerIds: [...crewNow, off.id] }]);
    const crew = await db.job.findUnique({ where: { id: jobId }, select: { cleaners: { select: { id: true } } } });
    check("assigning a switched-off cleaner is refused, and the crew is unchanged",
      !ok(r) && !crew?.cleaners.some((x) => x.id === off.id), show(r));
    r = await call(c.admin, "assignCleaners", [{ jobId, cleanerIds: [...crewNow, owner.id] }]);
    check("assigning an owner (not crew) is refused", !ok(r), show(r));
    r = await call(c.ops, "bulkAssignCleaner", [[jobId], off.id]);
    check("bulk-assigning a switched-off cleaner is refused", said(r, /not found/i), show(r));
    r = await call(c.admin, "assignCleaners", [{ jobId, cleanerIds: [...crewNow, extra.id] }]);
    check("assigning an active cleaner still works", ok(r), show(r));

    console.log("\n── 6. Team chat deletion");
    const ch = await db.groupChannel.create({ data: { organizationId: orgId, name: `${NAME} ${tag}`, isDefault: false, isActive: true } });
    const gm = await db.groupMessage.create({ data: { organizationId: orgId, channelId: ch.id, senderId: theirs.id, senderName: theirs.name, body: NAME } });
    r = await call(c.admin, "deleteGroupMessage", [gm.id]);
    const logged = await db.activityLog.findFirst({ where: { targetId: gm.id, action: "groupchat.message.deleted" } });
    check("deleting a team chat message records who deleted it", ok(r) && logged?.actorId === admin.id, `${show(r)} actor=${logged?.actorId}`);
    await db.activityLog.deleteMany({ where: { targetId: gm.id } });
  } catch (e) {
    fail++;
    console.log("ERROR", (e as Error)?.stack ?? e);
  } finally {
    const convNow = await db.chatConversation.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const backfilled = convNow.map((x) => x.id).filter((id) => !convBefore.has(id));
    await db.chatMessage.deleteMany({ where: { conversationId: { in: backfilled } } }).catch(() => {});
    await db.chatConversation.deleteMany({ where: { id: { in: backfilled } } }).catch(() => {});
    await sweep();
    const leftUsers = await db.user.count({ where: { email: { startsWith: PREFIX } } });
    const leftJobs = await db.job.count({ where: { clientName: { startsWith: NAME } } });
    console.log(`\ncleanup: ${leftUsers} test users and ${leftJobs} test jobs remain; ${backfilled.length} backfilled conversations removed`);
    await db.$disconnect();
  }
}

void (async () => {
  if (process.argv.includes("--staging")) {
    await e2e();
  } else {
    console.log("SKIP  end-to-end scenarios — pass --staging --port <n> with a staging server running");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
