// Read-only snapshot of the test fixtures, so a run starts from a known state.
import { PrismaClient } from "@prisma/client";
import { readManifest, MARKER } from "./lib/manifest.mjs";

const db = new PrismaClient();
const man = readManifest();
const by = {};
for (const r of man) (by[r.model] ??= []).push(r.id);

const users = await db.user.findMany({
  where: { email: { contains: "cleano-bt.local" } },
  select: { id: true, email: true, role: true, isActive: true, emailVerified: true, allowedServiceCategories: true },
});
const clients = await db.client.findMany({
  where: { name: { contains: MARKER } },
  select: { id: true, name: true, email: true, referralCredit: true },
});
const jobs = await db.job.findMany({
  where: { id: { in: by.Job ?? [] } },
  select: {
    id: true, clientName: true, status: true, price: true, jobType: true,
    bookingSource: true, employeeId: true, startTime: true, notes: true,
    subtotalAmount: true, totalAmount: true,
    addOns: { select: { name: true, price: true, quantity: true } },
    assignments: { select: { cleanerId: true, status: true } },
    workSessions: { select: { id: true, startedAt: true, endedAt: true } },
  },
});
const addrs = await db.clientAddress.findMany({
  where: { OR: [{ label: { contains: MARKER } }, { address: { contains: MARKER } }] },
  select: { id: true, label: true, address: true, city: true, postalCode: true, accessNotes: true, isDefault: true },
});

console.log("USERS:", JSON.stringify(users, null, 1));
console.log("CLIENTS:", JSON.stringify(clients, null, 1));
console.log("JOBS:", JSON.stringify(jobs, null, 1));
console.log("ADDRESSES:", JSON.stringify(addrs, null, 1));
console.log("MANIFEST:", man.length, "rows");
await db.$disconnect();
