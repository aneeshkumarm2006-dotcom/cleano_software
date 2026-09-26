/**
 * API v1 integration checks for messages, kit and availability
 * (packages/api/src/v1/messages.ts, kit.ts, availability.ts).
 *
 * Run by scripts/api-v1-integration.ts against its two throwaway companies;
 * everything created here lives in company A or B and goes when they do.
 */
import { randomUUID } from "node:crypto";
import type http from "node:http";

import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { PASSWORD, type Fixture } from "./fixture";

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

export interface TalkHarness {
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

export async function runTalkChecks(t: TalkHarness): Promise<void> {
  const { db, F, HOST_A, call, check, signIn } = t;
  const A = F.orgA.id;

  const send = (method: string, path: string, cookie: string, body: Record<string, unknown>, key?: string) =>
    call(method, HOST_A, path, {
      cookie,
      body,
      headers: key === "" ? {} : { "Idempotency-Key": key ?? String(body.clientEventId) },
    });
  const get = (path: string, cookie: string) => call("GET", HOST_A, path, { cookie });

  // A field lead of company A, for the "leads post as EMPLOYEE" rule.
  const hashed = await hashPassword(PASSWORD);
  const lead = await db.user.create({
    data: {
      organizationId: A,
      name: "Lead Tester",
      email: `lead-${randomUUID().slice(0, 8)}@v1test-alpha.test`,
      role: "FIELD_LEAD",
      emailVerified: true,
      isActive: true,
    },
    select: { id: true, email: true },
  });
  await db.account.create({ data: { userId: lead.id, accountId: lead.id, providerId: "credential", password: hashed } });

  const cleaner = await signIn(HOST_A, F.users.cleaner.email);
  const teammate = await signIn(HOST_A, F.users.teammate.email);
  const owner = await signIn(HOST_A, F.users.owner.email);
  const client = await signIn(HOST_A, F.users.client.email);
  const leadCookie = await signIn(HOST_A, lead.email);

  // ── Office chat ────────────────────────────────────────────────────────
  {
    const s = await get("/api/v1/chat", cleaner);
    check("chat: summary for the caller", s.status === 200 && s.body?.unreadCount === 0 && typeof s.body?.officeOnline === "boolean", s.body);
    const o = await get("/api/v1/chat", owner);
    check("chat: an OWNER is not a crew caller (403)", o.status === 403, o.body);

    const e = { body: "  Running ten minutes late  ", clientEventId: randomUUID() };
    const noKey = await send("POST", "/api/v1/chat/messages", cleaner, e, "");
    check("chat send: needs an Idempotency-Key", noKey.status === 400, noKey.body);
    const r = await send("POST", "/api/v1/chat/messages", cleaner, e);
    check(
      "chat send: saved, trimmed, mine, EMPLOYEE, with my event id",
      r.status === 200 && r.body?.body === "Running ten minutes late" && r.body?.fromMe === true &&
        r.body?.senderRole === "EMPLOYEE" && r.body?.clientEventId === e.clientEventId,
      r.body,
    );
    const again = await send("POST", "/api/v1/chat/messages", cleaner, e);
    const count = await db.chatMessage.count({ where: { clientEventId: e.clientEventId } });
    check("chat send: a replay returns the same message and posts once", again.status === 200 && again.headers["idempotent-replayed"] === "true" && again.body?.id === r.body?.id && count === 1, { again: again.body, count });
    const empty = await send("POST", "/api/v1/chat/messages", cleaner, { body: "   ", clientEventId: randomUUID() });
    check("chat send: an empty body is 400", empty.status === 400, empty.body);
    const long = await send("POST", "/api/v1/chat/messages", cleaner, { body: "x".repeat(4001), clientEventId: randomUUID() });
    check("chat send: over 4000 is 400", long.status === 400, long.body);

    const le = { body: "Lead here", clientEventId: randomUUID() };
    const lr = await send("POST", "/api/v1/chat/messages", leadCookie, le);
    const lrow = await db.chatMessage.findFirst({ where: { clientEventId: le.clientEventId }, include: { conversation: true } });
    check(
      "chat send: a FIELD_LEAD posts as EMPLOYEE in their own conversation",
      lr.status === 200 && lrow?.senderRole === "EMPLOYEE" && lrow.conversation.employeeId === lead.id && lrow.readByAdminAt === null,
      { body: lr.body, lrow },
    );

    // The office replies (as the web would), once with an attachment URL that isn't ours.
    const conv = await db.chatConversation.findFirst({ where: { employeeId: F.users.cleaner.id } });
    await db.chatMessage.create({
      data: {
        organizationId: A,
        conversationId: conv!.id,
        senderId: F.users.owner.id,
        senderRole: "ADMIN",
        body: "Thanks for letting us know",
        attachmentUrl: "https://evil.example/steal.png",
        attachmentType: "image",
        attachmentName: "x.png",
      },
    });
    const s2 = await get("/api/v1/chat", cleaner);
    check("chat: the office's message is unread, and reading the summary doesn't change that", s2.body?.unreadCount === 1, s2.body);
    const list = await get("/api/v1/chat/messages", cleaner);
    const first = list.body?.items?.[0];
    check(
      "chat messages: newest first, the office's has no event id, a foreign attachment URL is left out",
      list.status === 200 && first?.senderRole === "ADMIN" && first.fromMe === false && first.clientEventId === null && first.attachment === null,
      list.body,
    );
    const theirs = await get("/api/v1/chat/messages", teammate);
    check("chat messages: another cleaner sees none of mine", theirs.status === 200 && theirs.body?.items?.length === 0, theirs.body);
    const read = await call("POST", HOST_A, "/api/v1/chat/read", { cookie: cleaner, body: {} });
    check("chat read: unread goes to 0", read.status === 200 && read.body?.unreadCount === 0, read.body);

    // Paging.
    await db.chatMessage.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        organizationId: A,
        conversationId: conv!.id,
        senderId: F.users.cleaner.id,
        senderRole: "EMPLOYEE" as const,
        body: `filler ${i}`,
        createdAt: new Date(Date.now() - (i + 10) * 60_000),
      })),
    });
    const p1 = await get("/api/v1/chat/messages", cleaner);
    const p2 = await get(`/api/v1/chat/messages?cursor=${encodeURIComponent(p1.body?.nextCursor ?? "")}`, cleaner);
    const ids = new Set([...(p1.body?.items ?? []), ...(p2.body?.items ?? [])].map((m: { id: string }) => m.id));
    check("chat messages: keyset pages don't overlap and cover everything", p1.body?.items?.length === 30 && !!p1.body?.nextCursor && ids.size === 30 + (p2.body?.items?.length ?? 0)&& ids.size === 37, { p1: p1.body?.items?.length, p2: p2.body?.items?.length, size: ids.size });
    const bad = await get("/api/v1/chat/messages?cursor=not-a-cursor", cleaner);
    check("chat messages: a forged cursor is 400", bad.status === 400, bad.body);
  }

  // ── Team chat ──────────────────────────────────────────────────────────
  let defaultId = "";
  {
    const ch = await get("/api/v1/team/channels", cleaner);
    defaultId = ch.body?.items?.[0]?.id ?? "";
    check("team channels: the default channel first, DMs on by default", ch.status === 200 && ch.body?.items?.[0]?.kind === "DEFAULT" && ch.body?.dmEnabled === true, ch.body);
    const cl = await get("/api/v1/team/channels", client);
    check("team channels: a CLIENT is 403", cl.status === 403, cl.body);
    const ow = await get("/api/v1/team/channels", owner);
    check("team channels: an OWNER may read team chat", ow.status === 200, ow.body);

    const group = await db.groupChannel.create({
      data: {
        organizationId: A,
        name: "Teammate only",
        members: { create: [{ organizationId: A, userId: F.users.teammate.id }] },
      },
    });
    const g1 = await get(`/api/v1/team/channels/${group.id}`, cleaner);
    const g2 = await get(`/api/v1/team/channels/${group.id}`, owner);
    check("team channel: not a member is 404; a moderator sees it", g1.status === 404 && g2.status === 200 && g2.body?.kind === "GROUP", { g1: g1.body, g2: g2.body });
    const gs = await send("POST", `/api/v1/team/channels/${group.id}/messages`, cleaner, { body: "hi", clientEventId: randomUUID() });
    check("team send: to a channel I'm not in is 404", gs.status === 404, gs.body);

    const e = { body: "Anyone have spare gloves?", clientEventId: randomUUID() };
    const r = await send("POST", `/api/v1/team/channels/${defaultId}/messages`, cleaner, e);
    const again = await send("POST", `/api/v1/team/channels/${defaultId}/messages`, cleaner, e);
    const n = await db.groupMessage.count({ where: { clientEventId: e.clientEventId } });
    check("team send: saved once, replay returns it", r.status === 200 && r.body?.fromMe === true && r.body?.senderName === "Cleaner Tester" && again.body?.id === r.body?.id && n === 1, { r: r.body, n });
    const mid = r.body?.id as string;
    const seen = await get(`/api/v1/team/channels/${defaultId}/messages`, teammate);
    const theirView = seen.body?.items?.find((m: { id: string }) => m.id === mid);
    check("team messages: others see it, without my event id", theirView?.fromMe === false && theirView?.clientEventId === null, theirView);
    const chT = await get("/api/v1/team/channels", teammate);
    check("team channels: it is unread for the teammate", chT.body?.items?.[0]?.unreadCount >= 1, chT.body?.items?.[0]);
    const rd = await call("POST", HOST_A, `/api/v1/team/channels/${defaultId}/read`, { cookie: teammate, body: {} });
    const chT2 = await get("/api/v1/team/channels", teammate);
    check("team read: moves only the caller's cursor", rd.status === 200 && chT2.body?.items?.[0]?.unreadCount === 0, chT2.body?.items?.[0]);

    const path = `/api/v1/team/channels/${defaultId}/messages/${mid}`;
    const edT = await send("PATCH", path, teammate, { body: "hijack", clientEventId: randomUUID() });
    const edO = await send("PATCH", path, owner, { body: "hijack", clientEventId: randomUUID() });
    check("team edit: someone else's message is 404, an owner's call included", edT.status === 404 && edO.status === 404, { edT: edT.body, edO: edO.body });
    const ee = { body: "Anyone have spare gloves? Size M", clientEventId: randomUUID() };
    const ed = await send("PATCH", path, cleaner, ee);
    const ed2 = await send("PATCH", path, cleaner, ee);
    check("team edit: body and editedAt change, createdAt doesn't; replay is the same", ed.status === 200 && ed.body?.body === ee.body && !!ed.body?.editedAt && ed.body?.createdAt === r.body?.createdAt && ed2.body?.editedAt === ed.body?.editedAt, { ed: ed.body, ed2: ed2.body });
    const reuse = await send("PATCH", path, cleaner, { ...ee, body: "different" });
    check("team edit: the same key with another body is 422", reuse.status === 422, reuse.body);
    const edEmpty = await send("PATCH", path, cleaner, { body: " ", clientEventId: randomUUID() });
    check("team edit: an empty body is 400", edEmpty.status === 400, edEmpty.body);

    const del = (cookie: string) => call("DELETE", HOST_A, path, { cookie, headers: { "Content-Type": "application/json" } });
    const dT = await del(teammate);
    const dO = await del(owner);
    check("team delete: someone else's is 404 (moderation is the manager API)", dT.status === 404 && dO.status === 404, { dT: dT.body, dO: dO.body });
    const d1 = await del(cleaner);
    const d2 = await del(cleaner);
    const row = await db.groupMessage.findFirst({ where: { id: mid } });
    check("team delete: soft, answers { id } twice, records who, keeps the text server-side", d1.status === 200 && d1.body?.id === mid && d2.status === 200 && !!row?.deletedAt && row?.deletedById === F.users.cleaner.id && row?.body === ee.body, { d1: d1.body, d2: d2.body });
    const after = await get(`/api/v1/team/channels/${defaultId}/messages`, teammate);
    const gone = after.body?.items?.find((m: { id: string }) => m.id === mid);
    check("team messages: a deleted one keeps its place with no text", gone?.deleted === true && gone?.body === "", gone);
    const edDel = await send("PATCH", path, cleaner, { body: "back", clientEventId: randomUUID() });
    check("team edit: a deleted message is 409 MESSAGE_DELETED", edDel.status === 409 && edDel.body?.error?.code === "MESSAGE_DELETED", edDel.body);
  }

  // ── Directory and direct messages ──────────────────────────────────────
  {
    const d = await get("/api/v1/team/directory", cleaner);
    const ids = (d.body?.items ?? []).map((p: { id: string }) => p.id);
    check(
      "directory: teammates, never me, never another company, no contact details by default",
      d.status === 200 && ids.includes(F.users.teammate.id) && !ids.includes(F.users.cleaner.id) && !ids.includes(F.users.bCleaner.id) &&
        !ids.includes(F.users.client.id) && d.body.items.every((p: { email: unknown; phone: unknown }) => p.email === null && p.phone === null),
      d.body,
    );
    const self = await call("POST", HOST_A, "/api/v1/team/direct", { cookie: cleaner, body: { userId: F.users.cleaner.id } });
    check("direct: myself is 400", self.status === 400, self.body);
    const other = await call("POST", HOST_A, "/api/v1/team/direct", { cookie: cleaner, body: { userId: F.users.bCleaner.id } });
    check("direct: someone in another company is 404", other.status === 404, other.body);
    const [x, y] = await Promise.all([
      call("POST", HOST_A, "/api/v1/team/direct", { cookie: cleaner, body: { userId: F.users.teammate.id } }),
      call("POST", HOST_A, "/api/v1/team/direct", { cookie: teammate, body: { userId: F.users.cleaner.id } }),
    ]);
    const pairs = await db.groupChannel.count({
      where: {
        organizationId: A,
        isDirect: true,
        AND: [{ members: { some: { userId: F.users.cleaner.id } } }, { members: { some: { userId: F.users.teammate.id } } }],
      },
    });
    check(
      "direct: both people opening at once land in one conversation, titled with the other's name",
      x.status === 200 && y.status === 200 && x.body?.id === y.body?.id && pairs === 1 && x.body?.name === "Teammate Tester" && x.body?.kind === "DIRECT",
      { x: x.body, y: y.body, pairs },
    );

    await db.appSetting.create({ data: { organizationId: A, key: "team.chat", category: "team", value: { dmEnabled: false, showContactInfo: false } } });
    const off = await get("/api/v1/team/directory", cleaner);
    const offOpen = await call("POST", HOST_A, "/api/v1/team/direct", { cookie: cleaner, body: { userId: F.users.teammate.id } });
    check("direct messages off: the directory is empty and opening one is 403", off.body?.items?.length === 0 && off.body?.dmEnabled === false && offOpen.status === 403, { off: off.body, offOpen: offOpen.body });
    await db.appSetting.updateMany({ where: { organizationId: A, key: "team.chat" }, data: { value: { dmEnabled: true, showContactInfo: true } } });
    const on = await get("/api/v1/team/directory", cleaner);
    const mate = on.body?.items?.find((p: { id: string }) => p.id === F.users.teammate.id);
    check("directory: contact details only when the company shows them", mate?.email === F.users.teammate.email, mate);
  }

  // ── Kit ────────────────────────────────────────────────────────────────
  {
    const product = (name: string, extra: Record<string, unknown> = {}) =>
      db.product.create({ data: { organizationId: A, name, unit: "units", costPerUnit: 1, ...extra }, select: { id: true } });
    const gloves = await product("Gloves");
    const scraper = await product("Scraper", { itemType: "REUSABLE_EQUIPMENT" });
    const retired = await product("Retired spray", { deletedAt: new Date() });
    const locker = await db.inventoryLocation.create({ data: { organizationId: A, name: "Locker" }, select: { id: true } });
    const closed = await db.inventoryLocation.create({ data: { organizationId: A, name: "Closed", isActive: false }, select: { id: true } });
    await db.inventoryLocationStock.create({ data: { organizationId: A, locationId: locker.id, productId: gloves.id, quantity: 20 } });
    await db.product.update({ where: { id: gloves.id }, data: { stockLevel: 20 } });
    // The office assigns 5 gloves (assignment moves no warehouse stock).
    await db.employeeProduct.create({ data: { organizationId: A, employeeId: F.users.cleaner.id, productId: gloves.id, quantity: 5 } });
    await db.inventoryChange.create({
      data: { organizationId: A, productId: gloves.id, employeeId: F.users.cleaner.id, quantityChange: 5, newQuantity: 5, action: "ASSIGN", changedById: F.users.owner.id },
    });
    const stock = async () => (await db.product.findFirst({ where: { id: gloves.id }, select: { stockLevel: true } }))?.stockLevel;
    const locStock = async () =>
      (await db.inventoryLocationStock.findFirst({ where: { locationId: locker.id, productId: gloves.id }, select: { quantity: true } }))?.quantity;

    const k = await get("/api/v1/kit", cleaner);
    check("kit: my items, with the server's attention state", k.status === 200 && k.body?.items?.[0]?.productId === gloves.id && typeof k.body.items[0].attention?.label === "string", k.body);
    const ko = await get("/api/v1/kit", owner);
    check("kit: an OWNER is 403", ko.status === 403, ko.body);
    const cat = await get("/api/v1/kit/catalog", cleaner);
    const catIds = (cat.body?.items ?? []).map((p: { productId: string }) => p.productId);
    check("kit catalog: not what I have, not archived", catIds.includes(scraper.id) && !catIds.includes(gloves.id) && !catIds.includes(retired.id), cat.body);

    const add = { clientEventId: randomUUID(), productId: scraper.id, quantity: 1 };
    const a1 = await send("POST", "/api/v1/kit/items", cleaner, add);
    const a2 = await send("POST", "/api/v1/kit/items", cleaner, add);
    const a3 = await send("POST", "/api/v1/kit/items", cleaner, { ...add, clientEventId: randomUUID() });
    const aArch = await send("POST", "/api/v1/kit/items", cleaner, { clientEventId: randomUUID(), productId: retired.id, quantity: 1 });
    check("kit add: added once; a replay is the same; a second add is 409 ALREADY_IN_KIT; archived is refused",
      a1.status === 200 && a1.body?.productId === scraper.id && a2.status === 200 && a3.status === 409 && a3.body?.error?.code === "ALREADY_IN_KIT" && aArch.status === 409,
      { a1: a1.body, a3: a3.body, aArch: aArch.body });

    const cnt = await send("PUT", `/api/v1/kit/items/${gloves.id}/count`, cleaner, { clientEventId: randomUUID(), quantity: 3, reason: "Two used up" });
    check("kit count: recounted, company stock untouched", cnt.status === 200 && cnt.body?.quantity === 3 && (await stock()) === 20, cnt.body);
    const cntT = await send("PUT", `/api/v1/kit/items/${gloves.id}/count`, teammate, { clientEventId: randomUUID(), quantity: 3, reason: "x" });
    check("kit count: not in my kit is 404", cntT.status === 404, cntT.body);
    const cntBad = await send("PUT", `/api/v1/kit/items/${gloves.id}/count`, cleaner, { clientEventId: randomUUID(), quantity: 3, reason: "" });
    check("kit count: a reason is required (400)", cntBad.status === 400, cntBad.body);

    const cNot = await send("PUT", `/api/v1/kit/items/${gloves.id}/condition`, cleaner, { clientEventId: randomUUID(), condition: "DAMAGED" });
    const cOk = await send("PUT", `/api/v1/kit/items/${scraper.id}/condition`, cleaner, { clientEventId: randomUUID(), condition: "DAMAGED", note: "Blade bent" });
    const flags = await db.inventoryFlag.count({ where: { employeeId: F.users.cleaner.id, productId: scraper.id, status: "OPEN" } });
    check("kit condition: tools only (409 NOT_EQUIPMENT); a tool gets its condition and one review flag",
      cNot.status === 409 && cNot.body?.error?.code === "NOT_EQUIPMENT" && cOk.status === 200 && cOk.body?.condition === "DAMAGED" && flags === 1, { cNot: cNot.body, cOk: cOk.body, flags });

    // Issues. Custody: 5 assigned. Kit: 3.
    const lost2 = { clientEventId: randomUUID(), type: "LOST", quantity: 2 };
    const l1 = await send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, lost2);
    const l1r = await send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, lost2);
    check("kit issue: LOST of assigned stock comes off the kit and the warehouse, once", l1.status === 200 && l1.body?.quantity === 1 && l1r.status === 200 && (await stock()) === 18, { l1: l1.body, stock: await stock() });
    const tooMany = await send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, { clientEventId: randomUUID(), type: "LOST", quantity: 5 });
    check("kit issue: more than the kit holds is 409 NOT_ENOUGH_IN_KIT", tooMany.status === 409 && tooMany.body?.error?.code === "NOT_ENOUGH_IN_KIT", tooMany.body);

    // A self-reported recount can't be written off past custody (3 left).
    await send("PUT", `/api/v1/kit/items/${gloves.id}/count`, cleaner, { clientEventId: randomUUID(), quantity: 10, reason: "Found a box" });
    const l2 = await send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, { clientEventId: randomUUID(), type: "BROKEN", quantity: 8 });
    check("kit issue: a write-off is capped at what the office issued; the rest is kit-only", l2.status === 200 && l2.body?.quantity === 2 && (await stock()) === 15, { l2: l2.body, stock: await stock() });

    // Pickup 4 from the locker: the location goes down once.
    const pick = { clientEventId: randomUUID(), locationId: locker.id, items: [{ productId: gloves.id, quantity: 4 }] };
    const pk = await send("POST", "/api/v1/kit/pickups", cleaner, pick);
    const pk2 = await send("POST", "/api/v1/kit/pickups", cleaner, pick);
    const kitNow = await db.employeeProduct.findFirst({ where: { employeeId: F.users.cleaner.id, productId: gloves.id } });
    check("kit pickup: into my kit and off the location, once", pk.status === 200 && !!pk.body?.pickupId && pk2.body?.pickupId === pk.body?.pickupId && kitNow?.quantity === 6 && (await locStock()) === 11, { pk: pk.body, kit: kitNow?.quantity, loc: await locStock() });
    const dup = await send("POST", "/api/v1/kit/pickups", cleaner, { clientEventId: randomUUID(), locationId: locker.id, items: [{ productId: gloves.id, quantity: 1 }, { productId: gloves.id, quantity: 1 }] });
    const pkClosed = await send("POST", "/api/v1/kit/pickups", cleaner, { clientEventId: randomUUID(), locationId: closed.id, items: [{ productId: gloves.id, quantity: 1 }] });
    check("kit pickup: a product twice is 400; an inactive location is 404", dup.status === 400 && pkClosed.status === 404, { dup: dup.body, pkClosed: pkClosed.body });

    // Writing off picked-up stock never takes it off the location again.
    const l3 = await send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, { clientEventId: randomUUID(), type: "LOST", quantity: 4 });
    check("kit issue: picked-up stock is written off without touching the location twice", l3.status === 200 && (await locStock()) === 11 && (await stock()) === 11, { l3: l3.body, loc: await locStock(), stock: await stock() });

    // Two reports at once can't spend the same stock (kit: 2).
    const [c1, c2] = await Promise.all([
      send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, { clientEventId: randomUUID(), type: "RAN_OUT", quantity: 2 }),
      send("POST", `/api/v1/kit/items/${gloves.id}/issues`, cleaner, { clientEventId: randomUUID(), type: "RAN_OUT", quantity: 2 }),
    ]);
    const final = await db.employeeProduct.findFirst({ where: { employeeId: F.users.cleaner.id, productId: gloves.id } });
    check("kit issue: of two simultaneous reports for the whole kit, one wins and one is 409", [c1.status, c2.status].sort().join() === "200,409" && final?.quantity === 0, { c1: c1.status, c2: c2.status, q: final?.quantity });

    const rq = { clientEventId: randomUUID(), items: [{ productId: gloves.id, quantity: 5 }, { productId: scraper.id, quantity: 1 }], note: "Out of gloves" };
    const r1 = await send("POST", "/api/v1/kit/requests", cleaner, rq);
    const r2 = await send("POST", "/api/v1/kit/requests", cleaner, { ...rq, clientEventId: randomUUID() });
    const pending = await db.inventoryRequest.count({ where: { employeeId: F.users.cleaner.id, status: "PENDING" } });
    check("kit restock: created once; asking again is ALREADY_PENDING", r1.status === 200 && r1.body?.results?.every((x: { outcome: string }) => x.outcome === "CREATED") && r2.body?.results?.every((x: { outcome: string }) => x.outcome === "ALREADY_PENDING") && pending === 2, { r1: r1.body, r2: r2.body, pending });
    const rDup = await send("POST", "/api/v1/kit/requests", cleaner, { clientEventId: randomUUID(), items: [{ productId: gloves.id, quantity: 1 }, { productId: gloves.id, quantity: 2 }] });
    check("kit restock: a product twice is 400", rDup.status === 400, rDup.body);
    const kit2 = await get("/api/v1/kit", cleaner);
    check("kit: shows the pending request", !!kit2.body?.items?.find((i: { productId: string }) => i.productId === gloves.id)?.pendingRequest, kit2.body);

    const locs = await get("/api/v1/kit/locations", cleaner);
    const lp = await get(`/api/v1/kit/locations/${locker.id}/products`, cleaner);
    const lpClosed = await get(`/api/v1/kit/locations/${closed.id}/products`, cleaner);
    check("kit locations: active only; products with what's on record; inactive is 404",
      locs.body?.items?.some((l: { id: string }) => l.id === locker.id) && !locs.body?.items?.some((l: { id: string }) => l.id === closed.id) &&
        lp.body?.items?.find((p: { productId: string }) => p.productId === gloves.id)?.available === 11 && lpClosed.status === 404,
      { locs: locs.body, lp: lp.body, lpClosed: lpClosed.status });
  }

  // ── Availability ───────────────────────────────────────────────────────
  {
    const g = await get("/api/v1/availability", cleaner);
    check("availability: seven days, Monday first, off by default", g.status === 200 && g.body?.week?.length === 7 && g.body.week[0].day === "MONDAY" && g.body.week.every((d: { available: boolean }) => !d.available), g.body);
    // A limit set on the web must survive a save from the phone.
    await db.employeeAvailability.create({
      data: { organizationId: A, employeeId: F.users.cleaner.id, day: "MONDAY", startTime: "08:00", endTime: "12:00", isRecurring: false, effectiveTo: new Date(Date.UTC(2027, 0, 31)) },
    });
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((day, i) => ({
      day,
      available: i < 5,
      start: "09:00",
      end: "17:00",
    }));
    const w = await send("PUT", "/api/v1/availability/week", cleaner, { clientEventId: randomUUID(), days });
    check("availability week: saved, and the web's limits kept", w.status === 200 && w.body?.week?.[0]?.available === true && w.body?.isRecurring === false && w.body?.effectiveTo === "2027-01-31", w.body);
    const six = await send("PUT", "/api/v1/availability/week", cleaner, { clientEventId: randomUUID(), days: days.slice(0, 6) });
    const twice = await send("PUT", "/api/v1/availability/week", cleaner, { clientEventId: randomUUID(), days: [...days.slice(0, 6), days[0]] });
    const back = await send("PUT", "/api/v1/availability/week", cleaner, { clientEventId: randomUUID(), days: days.map((d, i) => (i === 0 ? { ...d, start: "18:00", end: "09:00" } : d)) });
    check("availability week: six days, a day twice, or an end before the start is 400", six.status === 400 && twice.status === 400 && back.status === 400, { six: six.status, twice: twice.status, back: back.status });

    const today = new Date();
    const key = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + n)).toISOString().slice(0, 10);
    const off = { clientEventId: randomUUID(), from: key(10), to: key(12), reason: "Vacation" };
    const o1 = await send("POST", "/api/v1/availability/days-off", cleaner, off);
    check("days off: three days", o1.status === 200 && o1.body?.daysOff?.filter((d: { reason: string }) => d.reason === "Vacation").length === 3, o1.body);
    const o32 = await send("POST", "/api/v1/availability/days-off", cleaner, { clientEventId: randomUUID(), from: key(20), to: key(51) });
    const oRev = await send("POST", "/api/v1/availability/days-off", cleaner, { clientEventId: randomUUID(), from: key(12), to: key(10) });
    const oFar = await send("POST", "/api/v1/availability/days-off", cleaner, { clientEventId: randomUUID(), from: key(800), to: key(801) });
    check("days off: over 31 days, backwards, or past the window is 400", o32.status === 400 && oRev.status === 400 && oFar.status === 400, { o32: o32.body, oRev: oRev.status, oFar: oFar.status });
    await db.availabilityException.create({ data: { organizationId: A, employeeId: F.users.teammate.id, date: new Date(`${key(11)}T00:00:00Z`) } });
    const del = await call("DELETE", HOST_A, `/api/v1/availability/days-off?from=${key(10)}&to=${key(11)}`, { cookie: cleaner, headers: { "Content-Type": "application/json" } });
    const mateKept = await db.availabilityException.count({ where: { employeeId: F.users.teammate.id } });
    check("days off: removing a range removes only mine", del.status === 200 && del.body?.daysOff?.length === 1 && mateKept === 1, { del: del.body, mateKept });
    const del2 = await call("DELETE", HOST_A, `/api/v1/availability/days-off?from=${key(10)}&to=${key(11)}`, { cookie: cleaner, headers: { "Content-Type": "application/json" } });
    check("days off: removing an empty range is no error", del2.status === 200, del2.body);
  }
}
