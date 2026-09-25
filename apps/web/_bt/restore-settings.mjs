// Restore every AppSetting this test round edited, byte-for-byte from the backup
// taken before the first edit. Idempotent; safe to run more than once.
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
const db = new PrismaClient();
const path = "_bt/settings-backup.json";
if (!existsSync(path)) { console.log("no backup file — nothing to restore"); process.exit(0); }
const rows = JSON.parse(readFileSync(path, "utf8"));
for (const r of rows) {
  const before = await db.appSetting.findUnique({ where: { key: r.key } });
  await db.appSetting.update({ where: { key: r.key }, data: { value: r.value } });
  const same = JSON.stringify(before?.value) === JSON.stringify(r.value);
  console.log(`${r.key}: ${same ? "already original" : "RESTORED"}`);
}
// Prove it took.
for (const r of rows) {
  const now = await db.appSetting.findUnique({ where: { key: r.key } });
  const ok = JSON.stringify(now.value) === JSON.stringify(r.value);
  console.log(`  verify ${r.key}: ${ok ? "matches backup" : "MISMATCH"}`);
}
await db.$disconnect();
