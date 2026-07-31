# Stage 5 — schema design note (chat features + FAQ system)

**Written:** 2026-07-31, before any migration was created.
**Covers:** `CLN-P0-3-05`, `CLN-P0-3-14`, `CLN-P0-3-17`, `CLN-P1-4-06/08/09/10/11/17`, and keeping `CLN-P1-4-18` true.
**Status:** ⛔ **NOT APPLIED.** The migrations below are written to `prisma/migrations/` but have **not** been run — this working copy has no `DATABASE_URL` / `DIRECT_URL`, so `prisma migrate deploy` cannot reach the database. See "Deploy order" at the bottom. Nothing here is on `origin/main`.

---

## 0. Deploy order — read this first

This project does **not** run migrations on deploy (`postinstall` is `prisma generate` only). The two previous migrations left the **database ahead of the code**, which is the safe direction. **This batch is the opposite: the code needs columns and tables that do not exist in production yet.** Pushing the code before applying the migration would 500 the job-chat thread, both FAQ pages and the settings tab.

Required order, per hard rule:

1. `pg_dump` snapshot.
2. `npx prisma migrate deploy` against production (never `migrate dev`).
3. Verify with the post-apply SQL in each migration's header comment.
4. *Then* push the code.

Every migration in this batch is additive: new nullable columns, new tables, new enums. No column is dropped, no type narrowed, no `NOT NULL` added to an existing table. Live code that predates the migration keeps working while the DB is ahead, and the rollback in each header restores the prior schema with no data loss.

**The one exception to "additive only" is deliberate and is data, not schema:** `20260731020000_faq_tables` copies the `content.faqs` JSON blob into the new `Faq` table. It **reads** the AppSetting row and never modifies or deletes it, so the legacy path stays intact and the copy is re-runnable in the sense that it is guarded by `WHERE NOT EXISTS (SELECT 1 FROM "Faq")`.

---

## 1. Landmine that needs a decision — `JobChatMessage` cascade

`JobChatMessage.job` is `onDelete: Cascade` (`schema.prisma:1287`), and `permanentlyDeleteJobs` (`src/app/admin/actions/permanentlyDeleteJobs.ts:55`) hard-deletes archived jobs — so a permanent delete destroys the whole conversation. That directly contradicts:

- `CLN-P0-3-15` — "keep a permanent history for complaints, disputes, access issues, quality reviews, and payment disputes"
- `CLN-P0-3-17` — "hide … while **preserving the original in audit history**"

The action's own doc comment already shows the intended convention: `Invoice`, `Transaction`, `Complaint` and `CleanerStrike` use `onDelete: SetNull` precisely so financial and audit history survives. Chat does not.

**Not changed in this batch — needs Prem.** Three options:

| | Change | Cost |
|---|---|---|
| **A** | `jobId` → nullable + `onDelete: SetNull` | Chat survives a permanent delete but is orphaned (no job to read it from). Needs a UI to reach it. `jobId` is currently required, so this widens a `NOT NULL` — the one non-additive change in the set. |
| **B** | Block permanent delete when the job has chat messages | No schema change at all. Admin must accept archive-only for any job that was ever discussed. |
| **C** | Accept it, and rely on the mitigation below | Zero cost, partial coverage. |

**Mitigation shipped regardless (C, and it makes A/B optional rather than urgent):** the moderation action for `CLN-P0-3-17` copies the message's full original text into `ActivityLog.metadata` at hide time. `ActivityLog` has no FK to `Job` and does not cascade, so a hidden message's original survives a permanent delete. This covers the "preserving the original in audit history" clause of 3-17 specifically; it does **not** cover 3-15's "permanent history" for the ordinary, never-moderated messages.

**Recommendation: B.** It is the only option with no schema change, it cannot orphan data, and "you archived it, and it had a conversation on it, so it stays archived" is a defensible rule for a business that needs disputes on record. → **Question for Prem, recorded as Stage 6 Q7.**

---

## 2. `CLN-P0-3-05` — chat photo attachments

Migration `20260731000000_job_chat_attachments`.

```prisma
model JobChatMessage {
  // …existing…
  attachmentUrl    String?   // Cloudinary secure_url; NULL = text-only message
  attachmentWidth  Int?
  attachmentHeight Int?
}
```

**One attachment per message, not a child table.** Every chat product treats a photo as its own message; two photos are two messages. A `JobChatAttachment` table would add a second cascade edge to the landmine above for no behavioural gain.

**`body` stays `NOT NULL`.** A photo-only message stores `body = ""`. This is not a workaround bolted on late — `JobChatThread.tsx:259` already renders `{m.body && <div>{m.body}</div>}`, so the component was already written to tolerate an empty body. Making `body` nullable would flip the generated Prisma type to `string | null` and touch every reader for no gain.

**Width/height are stored** because Cloudinary returns them for free on upload and a chat that polls every 4s and auto-scrolls to the bottom will visibly jump if images have no reserved box.

**Upload path.** New `sendJobChatPhoto(formData)` in `src/lib/jobChatActions.ts`, following `uploadJobPhoto`'s Cloudinary pattern (10 MB cap, `image/jpeg|jpg|png|heic|heif|webp` allowlist, `upload_stream` with the 90s timeout for slow phone connections), into folder `cleano/job-chat/<jobId>`.

⚠️ **It must not reuse `uploadJobPhoto`'s authorization.** That action allows admin + assigned cleaner only; the **client** is a first-class participant in job chat and is not in that list. Authorization goes through the chat's own `resolveParticipant()`, which is the same gate `sendJobChatMessage` uses.

**No per-thread attachment cap.** `uploadJobPhoto` caps at 20 photos per job because that is a before/after evidence set with a natural size. A conversation has no such bound, and an arbitrary cap would silently break a long thread on a big job. The meaningful gates (participant-only, 10 MB, images only) are all present.

---

## 3. `CLN-P0-3-14` — disable messaging per booking or per user

Migration `20260731000000_job_chat_attachments` (same file — one migration for the whole chat batch keeps the manual apply to one step).

```prisma
model Job    { chatDisabledAt DateTime? }
model User   { chatDisabledAt DateTime? }
model Client { chatDisabledAt DateTime? }
```

The spec says "for a specific booking **or user**", and a "user" on this surface can be either side of the conversation: a cleaner is a `User`, a customer is a `Client`. Both get the flag.

**One nullable timestamp per entity, and nothing else.** No `chatDisabledBy` / `chatDisabledReason` columns: who did it, when, and why is exactly what `logActivity()` already records, and the settings spine established that convention. `NULL` = enabled, which means every existing row is enabled — identical to today's behaviour.

**Semantics — read-only, never invisible.** A disabled thread still renders its full history; only the composer goes away. Hiding the history would contradict `CLN-P0-3-10` (visible after completion) and `CLN-P0-3-15` (permanent history).

**Admins are exempt.** The disable applies to `CLEANER` and `CLIENT` senders. An admin can still post — moderation is the reason the switch exists, and someone has to be able to say *why* the thread was closed.

**Enforced server-side in every write path**, not just hidden in the UI (3-14 is a `permission` requirement):

1. `sendJobChatMessage`
2. `sendJobChatPhoto`
3. ⚠️ `POST /api/twilio/inbound` — the SMS bridge appends inbound texts as `CLIENT` messages with no session at all. Without the check there, a disabled customer just texts instead, and the disable is decorative.

---

## 4. `CLN-P0-3-17` — admin hide/moderate, original preserved

Same migration.

```prisma
model JobChatMessage {
  hiddenAt   DateTime?
  hiddenById String?   // soft reference, matching senderId's existing convention
}
```

Copies the `GroupMessage.deletedAt` moderation pattern (`groupChat.ts:690`), with two differences the requirement forces:

- **Named `hiddenAt`, not `deletedAt`.** The requirement is "hide … while preserving the original". `deletedAt` invites a future cleanup job to hard-delete the row.
- **Admins still see it, marked.** `GroupMessage` filters `deletedAt: null` for everyone. Here, `getJobChatMessages` filters `hiddenAt: null` for `CLEANER`/`CLIENT` viewers and returns hidden rows to `ADMIN` viewers with `hidden: true` on the DTO so the UI can mark them.

The row's `body` and `attachmentUrl` are **never modified** — that is the preservation. On top of it, `hideJobChatMessage` writes the original text to `ActivityLog.metadata` (see §1), which is the copy that survives a permanent job delete.

**Unhide is included.** Moderation is reversible; a mis-click that permanently silences a dispute record would be worse than the problem.

**Hidden messages never badge.** `getJobChatUnread` gains `hiddenAt: null` on all three scopes, so a hidden message cannot leave a cleaner or client staring at a count they can never clear.

---

## 5. FAQ tables — `CLN-P1-4-06/08/09/10/11`

Migration `20260731020000_faq_tables`.

```prisma
enum FaqStatus     { DRAFT PUBLISHED }
enum FaqVisibility { PUBLIC PORTAL BOTH }

model FaqCategory {
  id        String   @id @default(cuid())
  name      String                        // EN
  nameFr    String?                       // FR  (4-11)
  sortOrder Int      @default(0)          // 4-09 reorder
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  faqs      Faq[]
  @@index([sortOrder])
}

model Faq {
  id         String        @id @default(cuid())
  categoryId String?
  question   String        @db.Text
  answer     String        @db.Text
  questionFr String?       @db.Text       // 4-11
  answerFr   String?       @db.Text
  status     FaqStatus     @default(PUBLISHED)   // 4-08 draft/publish
  visibility FaqVisibility @default(BOTH)        // 4-10
  sortOrder  Int           @default(0)           // 4-08 reorder
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  category   FaqCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  events     FaqEvent[]
  @@index([status, visibility])
  @@index([categoryId, sortOrder])
}
```

**`categoryId` is nullable with `onDelete: SetNull`** — deleting a category must never destroy the questions in it. They fall into an "Uncategorised" group that both surfaces render last. This is the same lesson as the cascade landmine, applied up front.

**Defaults are chosen so a migrated row behaves exactly like today's JSON entry:** `PUBLISHED` + `BOTH` means every existing FAQ keeps appearing on both `/faq` and `/help` the moment the migration lands, with no admin action.

**Ten spec categories (4-06)** are seeded by the migration in spec order: Booking, Pricing, Payments, Cleaning Services, Add-ons, Rescheduling and Cancellations, Cleaner Arrival and Access, Supplies and Equipment, Recurring Services, Customer Accounts. Migrated questions land uncategorised — guessing which of the ten a free-text question belongs to would silently misfile the client's content.

**EN/FR (4-11).** The app has no i18n framework and no locale routing. Storing FR text that nothing can render would satisfy the letter of the requirement and none of its intent, so both FAQ surfaces get a lightweight `?lang=fr` toggle that falls back to the EN field whenever the FR one is blank. That is the whole scope of the French support in this stage — no other page is translated.

### Data migration out of `content.faqs`

The `AppSetting` row is **read and left in place** — not moved, not deleted.

```sql
INSERT INTO "Faq" (…)
SELECT … FROM "AppSetting" s, jsonb_array_elements(s.value) WITH ORDINALITY AS t(item, ord)
 WHERE s.key = 'content.faqs'
   AND NOT EXISTS (SELECT 1 FROM "Faq");
```

⚠️ **The case that silently loses content:** if an admin has never opened the FAQ editor there is **no `AppSetting` row at all**, and `getSetting` has been serving the two registry defaults. A migration that only copies the row would insert zero rows and both FAQ pages would go blank. The migration therefore has a second `INSERT … WHERE NOT EXISTS` that seeds those two default entries verbatim when the row is absent.

Ids are generated in SQL as `md5(random() || clock_timestamp() || ord)` rather than `gen_random_uuid()`, so the migration needs no extension on the target database.

### Backward compatibility

`faqList()` and the `content.faqs` registry entry (including its `audit: true` flag) stay exactly as they are. The new reader `getPublishedFaqs(surface, lang)` in `src/lib/faq.ts` falls back to `getSetting("content.faqs")` when the `Faq` table is empty **or when the query throws** — which is precisely what happens if the code is ever deployed before the migration is applied. The FAQ pages degrade to today's content instead of 500ing.

### ⚠️ `CLN-P1-4-18` would regress without this

FAQ edits are audit-logged today only because `content.faqs` carries `audit: true` and the settings spine writes the `ActivityLog` row (`settings/index.ts:144`). Once edits go to tables, that spine is out of the path. **Every FAQ server action therefore calls `logActivity()` itself** (`category: "ADMIN"`, `action: "faq.*"`, before/after values in metadata). Without that, fixing 4-18 in an earlier stage would have been undone here.

---

## 6. FAQ analytics — `CLN-P1-4-17`

Same migration.

```prisma
enum FaqEventType { VIEW OPEN SEARCH SEARCH_NO_RESULT }

model FaqEvent {
  id        String       @id @default(cuid())
  type      FaqEventType
  faqId     String?
  query     String?      // normalised (lowercased, trimmed, ≤80 chars)
  surface   String       // "public" | "portal"
  createdAt DateTime     @default(now())
  faq       Faq?         @relation(fields: [faqId], references: [id], onDelete: SetNull)
  @@index([type, createdAt])
  @@index([faqId, type])
  @@index([query])
}
```

The requirement asks for four things; two of them are the same signal on an accordion, and the note records that rather than inventing a distinction:

| Requirement phrase | Event | Note |
|---|---|---|
| most-viewed questions | `OPEN` | |
| questions opened most often | `OPEN` | **Same metric.** On an accordion a question is "viewed" only by being expanded. Logging an impression for every question rendered would produce ~20 rows per page load and measure page traffic, not interest. The admin panel labels this row "Most opened questions" once. |
| popular searches | `SEARCH` | Logged on a 700 ms debounce, ≥2 characters, so one search is one row rather than one per keystroke. |
| searches with no results | `SEARCH_NO_RESULT` | |

`VIEW` (one row per FAQ page load, `faqId` NULL) is kept as the denominator — "40 opens across 300 visits" is a different statement from "40 opens".

**`onDelete: SetNull` on `faqId`** — deleting a question must not rewrite history and drop its past traffic.

⚠️ **This adds an unauthenticated write endpoint** (the public `/faq` page must be able to log). It is bounded — a 4-value enum, an id that the FK rejects if forged, an 80-char query, fire-and-forget so it can never break the page — but it is unmetered, exactly like `/api/stripe/charge-deposit` and lead/quote submission. **Flagged, not silently fixed:** rate limiting is a separate ticket per the appendix, and adding one here only for FAQ would leave the money endpoints as the soft target while implying the problem was handled.

---

## 7. Migration files in this batch

| File | Contents | Applied? |
|---|---|---|
| `20260731000000_job_chat_attachments` | 5 columns on `JobChatMessage`, 1 each on `Job`/`User`/`Client`, 1 index | ❌ NOT APPLIED |
| `20260731020000_faq_tables` | 2 enums + `FaqCategory`/`Faq`, category seed, data copy out of `content.faqs` | ❌ NOT APPLIED |
| `20260731030000_faq_analytics` | `FaqEventType` enum + `FaqEvent` table | ❌ NOT APPLIED |

Each file's header carries its own pre-flight query, post-apply verification query, and rollback SQL.
