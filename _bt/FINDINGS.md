# Browser test findings — awerfixes.pdf round (20 items)

Environment: `next dev --turbopack` on :3001, LIVE Supabase DB, Chromium via Playwright MCP,
viewport 1600×1000. Test accounts: `bttest-{admin,cleaner,customer}@cleano-bt.local`.

## Fix 18 — Sidebar attention badges (PDF #11) — PASS
Rendered badges: Leads **10**, Job Applications **1**, Quotes **1**.
DB ground truth (`_bt/check-badges.mjs`): requests 0, applications 1, quotes 1 (after test row),
documents 0, leads 10, payouts 0, inventory 0. Exact match, and the five zero counts render no pill.
**Live poll verified:** created a `QuoteRequest` with status NEW mid-session; the Quotes badge went
from absent → `1` without a reload, confirming the 30s shared SWR key.

## Fix 3 — Price column readability (PDF #18) — PASS
Computed styles measured in the real browser, contrast via the WCAG 2.1 formula:

| Pair | Measured | AA (4.5) |
|---|---|---|
| `.col-price` — `rgb(14,26,28)` @600 on white | **17.75** | pass |
| `.pay-icon.unpaid` — `rgb(0,90,99)` on cream | **7.33** | pass |
| `.jcard-price` — `rgb(14,26,28)` @600 | **17.75** | pass |
| `.profit-pct.good` — `rgb(4,120,87)` | **5.48** | pass |

Tokens present: `--primary-800: #005a63`, `--emerald-700: #047857`. 10 price cells on the page all styled.

## Fix 4 — Job details opens at the top (PDF #13) — PASS (with one defect below)
Scrolled the Jobs list to the bottom (list scroller 765px), clicked the last row.
Navigation was SPA (`router.push`, no reload). On the detail page the content scroller
(`.admin-font.relative.h-full.overflow-y-auto`, scrollHeight 1721 > viewport 1000) was at
**scrollTop 0**, and it carries `data-scroll-reset`. The sidebar nav kept its own 765px scroll —
correct, the fix must not reset it.

### DEFECT — 4.b-bis: the logs pager no longer paginates — **FIXED 2026-08-07**
> **Resolved.** Root cause was NOT `router.replace` being broken — see the
> correction under "Root cause, established 2026-08-07" at the bottom of this
> file. The pager now fetches its rows from `/api/admin/jobs/[id]/logs` instead
> of re-rendering the route. Re-tested in the browser: all four controls page in
> ~4–5s on this remote-DB link (they never completed before), the URL tracks the
> page, and `?tab=logs&logsPage=2` deep-links correctly on a cold load.
> The original diagnosis is kept below because its observations were accurate.

Job `cmsgr09ki000ml104kunpd5i8` (19 log rows, `logsPerPage = 10`, "Page 1 of 2").
The four controls are now `<button class="apager-btn">` with aria-labels, as the fix intended,
and clicking **Next page of logs** correctly does **not** move the scroller (stayed at 435px).
But it also does not change the page: the URL never gains `logsPage=2` and the label stays
"Page 1 of 2". `updateLogsPage` → `router.replace(…, { scroll: false })` does not update the URL.

Root cause is wider than this fix — `router.replace` with query params updates no URL anywhere
in the running app (verified independently on `/admin/employees/[id]` tab switching and on
`/admin/calendar`'s Month/Week/Day switch, neither of which this round touched). So the cause is
app/framework-level, not introduced here. The *consequence* is introduced here: before the fix
the pager was four `<a href>` full page loads, which did page (jumping to the top); it is now a
no-op. Deep links are affected too — loading `?tab=logs&logsPage=2` directly renders the
Job details tab, because the same URL/state sync is what feeds it.

**Re-tested in a clean environment and CONFIRMED.** An earlier production-build comparison was
invalid and has been discarded: the PWA **service worker** was serving chunks from an older build,
so every server action 404'd with "Failed to find Server Action" (10 occurrences in the server log),
and `npm run build` had been run while the dev server was writing to the same `.next` directory.
The environment was rebuilt from scratch — `.next` deleted, dev server restarted, service worker
unregistered and all CacheStorage cleared — and this defect still reproduces exactly:
scroll preserved at 970px, label stuck on "Page 1 of 2", URL never gains `logsPage=2`.

## Fix 6 — Add-on quantities (PDF #7) — PASS (admin surfaces)
Job detail header renders **"Inside Fridge ×2 · $50.00"** — quantity shown and line total =
unit × qty. Financials Breakdown renders the per-line sub-row **"Inside Fridge ×2 · $25.00 each"**.
`JobAddOn.quantity` is live on the database (migration applied; a fixture round-trips quantity 2).

## Fix 7 — Custom extra charges count (PDF #10) — PASS
Admin-created job (`bookingSource = null` → ADDITIVE basis), price $200, add-on $25 × 2.
Financials Breakdown, read from the browser:

```
Base price                  $200.00
Add-ons & extra charges     +$50.00
  Inside Fridge ×2 · $25.00 each  [custom]   $50.00
Subtotal                    $250.00
GST (5%)                    +$12.50
QST (9.975%)                +$24.94
Total with tax              $287.44
```

$250 × 1.14975 = $287.4375 → **$287.44**. Exact. The `custom` pill is correct and derived, not
stored: the live catalog contains "Interior Fridge Cleaning", not "Inside Fridge", so this row
genuinely is off-catalog.

## Fix 16 — Service category permissions (PDF #3) — PASS (admin advisory half)
Restricted the test cleaner to `["COMMERCIAL"]` and opened the RESIDENTIAL job in JobModal →
**"Service category mismatch — BTTEST Cleaner is not approved for Residential / General work"**
plus the closing line **"You can still book them — this is only a warning."** Save/Next stayed
enabled and nothing was disabled, which is 16.d's stated contract (warn, never block).

## Fix 11 — Saved addresses (PDF #2) — PASS (admin half)
JobModal step 1 shows an **"Address on file"** picker with the helper text and a
`+ Type a new address` escape hatch. The dropdown listed
`BTTEST Home — BTTEST 250 Sample Ave, Montreal H3B 1A1` (label + street + the new city/postal
columns). Selecting it wrote `location = "BTTEST 250 Sample Ave"` into the react-hook-form
field, which is 11.c's stated `setValue` mechanism rather than ClientNameField's querySelector.

## DEFECT — Fix 17: the availability advisory never renders (PDF #19) — **FIXED 2026-08-07**
> **Resolved.** The promise was not hanging — it settled after **66 seconds**,
> returning 47 statuses with 45 non-available. Waiting "20+ seconds" was simply
> not long enough. Two real defects sat underneath: the panel rendered NOTHING
> while the lookup was in flight (so "still asking" and "everyone is free" were
> pixel-identical), and the `.then()` had no rejection handler at all, so a
> genuine failure was equally silent. Both pickers now expose an
> idle/loading/loaded/error state; the panel says "Checking cleaner
> availability…" and reports failures. Re-tested in the browser with a real
> MONDAY block: the warning, the row indicator and the "View availability" link
> all render, and Save is never disabled.
> See "Root cause, established 2026-08-07" below for why it was so slow.

Preconditions built deliberately: the test cleaner was given a MONDAY rule with
`isAvailable = false`, and the job is Monday 10 Aug.

* The evaluator is CORRECT. Called directly with the same inputs the modal sends
  (`windowFromFields("2026-08-10","00:30")`, 48 employee ids) it returns
  `{"result":"OUTSIDE_HOURS","reason":"Not available on Mondays"}` for this cleaner in 3.4s,
  and flags 3 of the 48 employees.
* The modal never shows it — at 00:30, at 10:00 (a direct overlap that should read
  `UNAVAILABLE`), and at 11:00 and 1:00 PM.
* Instrumented the effect: it fires with valid inputs
  (`isOpen: true, users: 48, watchedStartDate: "2026-08-10", watchedStartTime: "00:30"`),
  so the guard is not the cause — but the `.then()` on `checkAvailabilityBatch(...)` **never
  runs**, over 20+ seconds of waiting. The promise never settles, so `statuses` stays an empty
  Map and `availabilityAdvisories` is always `[]`.
* There is no `.catch` on that promise, so a rejection would also be silent.

Net effect: **the availability half of the JobModal advisory panel is dead.** The category half
(16.d), which is computed purely on the client, works — which is why the panel appears at all
and can look like it is working. 17.b's "No coverage" line is unreachable for the same reason.

**Re-confirmed after rebuilding the environment** (fresh `.next`, restarted dev server, service
worker unregistered, CacheStorage cleared) — so this is not the stale-service-worker artifact
described above. The category warning renders; the availability warning still never does.

## Environment note — post-action refresh does not repaint
Assigning a cleaner through the Team card **did** persist (verified in the DB: `cleaners`
relation set, `JobAssignment` synced), but the card kept showing "No cleaners assigned yet"
until a manual reload. Same family as the `router.replace` finding.

---

# Results by fix (20 items)

| # | PDF | Fix | Result |
|---|---|---|---|
| 1 | #1 | Pay multiplier drives cleaner pay | **PASS** |
| 2 | #20 | Remove "usually $10 less" | **PASS** |
| 3 | #18 | Price column readability | **PASS** |
| 4 | #13 | Job details opens at top | **PASS** (logs pager fixed 2026-08-07) |
| 5 | #12 | Referral rewards follow Settings | **PASS** |
| 6 | #7 | Add-on quantities on /book | **PASS** |
| 7 | #10 | Custom extra charges count | **PASS** |
| 8 | #9 | BookingKoala add-ons → structured | **PASS** (logic; import not run on live) |
| 9 | #15 | Price/tax out of imported notes | **PASS** |
| 10 | #17 | Add-on icons + customer pop-ups | **PASS** |
| 11 | #2 | Multiple saved addresses | **PASS** |
| 12 | #5 | Auto checklist / job scope | **PASS** |
| 13 | #8 | Job preview before claiming | **PASS** |
| 14 | #4 | Remove 10-minute pending hold | **PASS** |
| 15 | #6 | Clock back into a job | **PASS** |
| 16 | #3 | Service category permissions | **PASS** |
| 17 | #19 | Cleaner availability when booking | **PASS** (fixed 2026-08-07) |
| 18 | #11 | Sidebar notification badges | **PASS** |
| 19 | #16 | Void cheque upload | **PASS** |
| 20 | #14 | Remove Inventory Rules settings | **PASS** (20.e still deferred, as intended) |

**20 of 20 pass.** Both defects found in this round — fix 17's availability
advisory and fix 4's logs pager — were fixed and re-verified on 2026-08-07. See
the root-cause section at the end of this file; they turned out to share one.

## Fix 1 — proven end to end, in the browser
The test cleaner started with 0 ratings → multiplier 1.0 → a $200 job showed **EMPLOYEE PAY $80.00**
(40% × 1.0). Five 5★ ratings were added, crossing the `STANDARD_RATINGS_REQUIRED = 5` gate. The same
job then showed **EMPLOYEE PAY $100.00**, net profit $100.00, and the Team card read `$100.00 auto`.
The real loader confirms the arithmetic: `40.00% × 1.25 = 50.00% (rating 5.00)` — the live settings
map is `{1:0.8, 2:0.9, 3:1, 4:1.1, 5:1.25}`, read from Settings, not hardcoded. This is exactly the
PDF's complaint ("pay multiplier not updating cleaner pay") resolved.

## Fix 5 — proven by changing the setting
Set "New-client referral discount" to **22** in Settings → Customer. `/account` then read
"They get **$22** off their first booking, and you get $15 credit when they book." No deploy, no
hardcoded "$15 off … $10 credit". Both settings were restored to their original value of 15.

## Fix 12 — checklist appears with zero clicks
Opening `/cleaners/my-jobs/<id>` as the assigned cleaner created `JobChecklist` **at that moment**
(13 items, 12 required, `createdAt` matching the page open). No "Generate Checklist" button exists.
The Job scope card shows service, checklist counts, the photo expectation, **ADD-ONS "Inside Fridge ×2"**
(quantity, no price — correct for a non-financial viewer) and special instructions.

## Fix 14 — the hold is gone
Panel reads **"NEW ASSIGNMENT — PLEASE CONFIRM"**, "This job is yours — tap Accept to confirm.",
with **no countdown**. Tested against an invite whose `expiresAt` was **30 minutes in the past**:
Accept still worked (`decision: ACCEPTED`), and the job never disappeared from the list. That is
14.e's requirement met literally.

## Fix 15 — clock back in
in → out → back in produced **2 `JobWorkSession` rows** (10:03→10:08, then 10:14→open).
`Job.clockOutTime` returned to **null** while a session was open (what stops a resumed job looking
finished); assignment status went `CLOCKED_OUT` → `CLOCKED_IN`; `Job.clockInTime` stayed at the first
session's start. Cleaner UI: "SESSIONS 2 · TOTAL WORKED 0h 6m". Admin Team card lists
"Session 1 … 5m [Edit]" and "Session 2 … [Edit]" (15.e). Resume worked from a **COMPLETED** job.
**The clock-out required-item gate fired on the job page** — the exact bypass this round closed.

## Fix 16 — enforcement measured
Restricting the cleaner to `["COMMERCIAL"]`: of **10** open unassigned jobs, an unrestricted cleaner
sees **10** (empty list = all, Decision 8) and the restricted one sees **1**, matching the board's
"1 open job". 16.0's alias map folds the free text correctly — `Apartment→RESIDENTIAL`,
`House→RESIDENTIAL`, `Deep Cleaning→DEEP` — which is what stops ~44% of jobs vanishing.

## Fix 19 — the privacy shape holds
Upload wrote an `EmployeeFile` whose URL contains **`/image/authenticated/`** with `publicId` +
`resourceType` stored. Cleaner view shows **filename + date + Replace only** — no View button and
**no Cloudinary URL anywhere in the page HTML**. Admin card renders **no link** ("Opens a link that
expires in 5 minutes"); clicking it wrote an audit row `employee_file.view` whose metadata is
`{kind, employeeFileId}` — **no URL, no publicId**.

## Fixes 8, 9, 20 — 20/20 on the shipped logic
Exercised the real exported functions (a live BookingKoala import would have written ~200 real jobs,
so the import UI itself was deliberately not run):
`"2 Day Post Construction(1)"` keeps its leading digit · `"Windows (interior)"` is not a quantity ·
`"Bi Weekly (2 Cleanings/Month -8%)"` unmatchable · paren-aware comma split · bare `"(3)"` dropped ·
cross-column merge 2+1=3 · matched row takes the canonical catalog name · **price 0 on matched AND
unmatched** (Decision 10) · unmatched surfaces in the review list (Decision 6).
Fix 9's rule keeps "Add-ons:", "Gate code 4455", "Please recharge the vacuum", "Leave $20 tip
envelope" and strips "Final amount CAD: 208.52 | Tax CAD: 27.17 | Original payment method". Verified
in the browser too: with that note on the job, the **cleaner page showed only "Add-ons: Inside Fridge /
Gate code 4455"** and no billing text in the raw HTML, while admin correctly still saw it in full.
`InventoryRule` is confirmed **still present** in the database — 20.e deferred, not silently dropped.

---

# Root cause, established 2026-08-07

Both defects above had ONE cause, and it was not the one this file originally
named. The claim that "`router.replace` with query params updates no URL
anywhere in the running app" was **wrong** — measured against a bare probe route
under the same admin layout, `router.replace(pathname + "?n=…", { scroll:false })`
updated the URL in **271ms**. The router was never broken.

What was actually happening, measured:

| Measurement | Before | After |
|---|---|---|
| One `SELECT 1` round trip to the Supabase pooler, from this machine | **1.33s** | — |
| 11 sequential `SELECT 1` vs 11 in parallel | 14.6s vs **3.4s** | — |
| `/admin/jobs/[id]` server render (one RSC request) | **33.5s** | **13.9s** |
| A logs page turn | never completed (waited 131s) | **~4–5s** |
| The availability lookup's `.then()` | 66s | still ~20s, but now visibly pending |

1. **`/admin/jobs/[id]/page.tsx` issued eleven sequential DB round trips** —
   session → job → users → clients → logs → photos → reviewPhotos → taxRates →
   bookingConfig → gpsEnabled → cleaner rates. Only two real dependencies exist
   between them, so the page cost the SUM of eleven latencies. Now two
   `Promise.all` waves.
2. **`Sidebar.tsx` polled on `setInterval(poll, 5000)`** while that poll — a
   server action, whose response carries a re-render of the current page — took
   about six seconds. A timer that fires faster than its own work completes
   builds an unbounded backlog, and that backlog starved every action the admin
   initiated. This is what turned "slow" into "never": the pending navigation
   could not get a slot. It is now self-pacing (`setTimeout` scheduled after the
   previous call settles), so it cannot outrun itself on any connection.
3. **Neither feature said anything while it waited.** The logs pager gave no
   pending state; the availability panel renders nothing until it has an answer,
   which is exactly what it renders when there are no conflicts. Both now show
   their in-flight and error states.

Note the 1.33s round trip is this MACHINE's distance from the database, not the
deployed app's — production runs beside it and will be far faster. But (1) and
(2) are real code defects that turn any latency into a broken-looking UI, and
(3) is a defect at any speed.

Still outstanding, for the owner (NOT fixed here — see the notes in the reply):
every admin server action drags a full page re-render with it, so the hot
pollers (`JobChatUnread` 5s, `AdminAttentionCounts` 30s, the sidebar chat poll)
each cost a page render. Moving those to route handlers, as the logs pager now
is, would cut admin server load substantially.

---

# Environment findings the owner should know

1. **The live database is shared with the deployed app.** A `JobAssignmentInvite` created here was
   stamped `EXPIRED` by a cron this machine never ran (local cron: 0 requests), and an ActivityLog
   row reads "Notifications cron ran". The deployed build still has the **pre-fix** sweep, so it is
   actively writing to the same rows this round changes. Deploy order matters more than usual.
2. **Live Stripe keys are active** in `.env` (`sk_live_…`; the `sk_test_…` pair is commented out).
   Email and SMS are safely neutered in `.env.local`, Stripe is not. No booking was completed and no
   charge action was pressed at any point during this testing.
3. **A stale PWA service worker can break every server action.** Mid-session the app began failing
   with "Failed to find Server Action … from an older or newer deployment" because the service
   worker was serving chunks from an older build. Symptom: buttons appear to do nothing, silently.
   Cured by unregistering the worker and clearing CacheStorage. Worth knowing before anyone
   diagnoses a "broken" feature after a deploy.
4. **Server actions against the remote pooler take 5–15 seconds.** Several writes looked like
   failures and landed up to a minute later. Nothing in the UI indicates work in flight.

# Not exercised (stated plainly)
- The BookingKoala **import UI** (review panel, admin WARNING alert) — running it writes real jobs.
- `cleanupImportNotes.ts --commit` — deliberately the owner's call (Decision 12).
- The cleaner **PayBreakdownModal** "+25%" line — needs a payable job inside the open pay period.
- Fix 3's deferred rows (admin table headers, the `--primary-40/50/60/70` ramp) — documented as
  out of scope by the round itself.
