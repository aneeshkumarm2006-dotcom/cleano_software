# Build status, 9 September 2026

Internal working tracker. Covers what has been built, what is left from the
`fixes sept3` list, and where we stand against the October 10 launch plan.

Written to be honest rather than reassuring. Anything built but never run
against a real external service is marked as such, because a status doc that
hides that is worse than no status doc.

---

## 1. Where we stand today

| | |
|---|---|
| HEAD | `474d567` |
| Pushed | Yes, everything is on `origin/main` |
| Production database | Up to date, 109 migrations applied |
| Staging database | Up to date, 109 migrations applied |
| Working tree | Clean |
| Build | Clean |
| RLS coverage | 103 tenant tables, 0 unprotected, 0 warnings |

Nothing is pending. Both databases and the repository agree.

**For future deploys, the ordering rule holds:** run the migration before
pushing. Most new code degrades safely without its migration, but anything that
counts rows in a new table does not.

```
npx prisma migrate deploy     # production, reads .env
git push origin main
```

---

## 2. What we built

### AI receptionist
Answers customer texts and emails from the workspace's own services, prices,
service areas and policies. Hands off to a human when unsure, when asked for a
person, or when the customer is upset.

- `bba9e99` core plus knowledge base
- `9da6865` SMS flow, conversation memory, team inbox
- `b42d6b4` plumbing verified before giving it a voice
- `621346f` email leg, tenant-branded sending
- `a8fc7e0` real availability, lead capture, first contact
- `b95b548` `ea2510d` `51d823f` follow-up sequence that knows when to stop
- `7403420` admin sees when the assistant stops answering

### Texting and the Twilio connector
- `cf5b8a0` bring your own Twilio account, proved against Twilio before storing
- `644b0f2` `228932d` a workspace picks its own number, ownership proved
- `939516e` read the sender pools, because the number's own service field lies
- `a3f9910` report the webhook Twilio is actually reading, not the one we assume
- `fdb02b9` relay inbound texts on to a second system during a migration
- `66971e0` `c1cb63b` connector styling and corrected help text

### Subscriptions, Awer getting paid
- `6a0030d` Stripe checkout, billing portal, annual pricing, plan and cap model
- `7f4e819` trial reminder and expiry cron, without switching anyone off
- `474d567` plan switching in place, dunning email, one product per plan
- `b830a8f` Meta pixel, confined to the public funnel

### Security and platform
- `c2441e3` rate limiting on every unauthenticated endpoint
- `a979922` fixes from the security audit
- `19ff37f` RLS checker reads the real catalog
- `b4c5c8a` refuse credentials posted from another origin
- `14a567c` full-height pages mean the screen the customer can see

### The Sept 3 fix list
Eight items, covered in section 3.

### Migrations added
- `20260907170000_subscription_billing`
- `20260909100000_announcement_reads`
- `20260909140000_admin_notifications`

---

## 3. The `fixes sept3` list, item by item

Ten of thirteen are complete. Three are partial, and the reasons matter.

| # | Item | P | Status |
|---|---|---|---|
| 1 | Notification system for cleaner and admin job events | P0 | Mostly done |
| 2 | Clear clock-in data when a job is duplicated or rescheduled | P0 | Done |
| 3 | Missing hamburger menu on admin mobile | P0 | Already built, needs a device check |
| 4 | Required cleaner count for jobs | P1 | Mostly done |
| 5 | Recurring schedule cancellation and postpone | P1 | Done |
| 6 | Show client phone only after a cleaner accepts | P1 | Half done |
| 7 | Shift drop email notifications | P1 | Done |
| 8 | Exclude cancelled bookings from daily job count | P1 | Done |
| 9 | Assign cleaner button in the job preview panel | P1 | Done |
| 10 | Custom pay amount per cleaner on the same job | P1 | Mostly done |
| 11 | Improve job preview panel layout | P1 | Mostly done |
| 12 | Default Jobs page sorting and date range | P1 | Done |
| 13 | Announcements to cleaners with admin visibility | P1 | Done |

### Detail on the ones that are not simply done

**#1 Notifications.** The diagnosis in the fix doc was wrong in a useful way.
Every trigger was already firing: claimed, clocked in, checklist, new available
jobs. The real problems were different, and all three are now fixed:

- `admin.clock.clocked_out` was set to `EMAIL: false` in the catalog. The email
  had existed and been wired since the clock shipped. One flag stopped it.
- Photo uploads had no notification at all. Added, firing on the first photo
  only, because photos upload one at a time and a mail each is eight for one
  bathroom.
- There was no in-app record of any event, only email, so sidebar badges could
  not work at all. There is now a notification centre. The event is recorded
  whether or not the email was enabled or delivered, so "we never heard about
  it" is something you check rather than guess at.

Still open: **"admin notified when a cleaner reports an issue."** There is no
issue-reporting feature anywhere in the app. This is not a notification fix, it
is a new feature. See section 6.

**#3 Hamburger.** `Sidebar.tsx` renders `md:hidden fixed top-4 left-4 z-30`
with a backdrop, a drawer and a close button, and the layout reserves `pt-16`
for it. It has been there since 25 June. The Sept 3 screenshot shows it
missing, so either that was a stale build or something on the dashboard covers
it. **Load `/admin` on a phone before we spend time here.**

**#4 Required cleaner count.** The column was read everywhere already: spots
open in the cleaner app, the claim cap, "N of M assigned" on the calendar,
partial staffing on web bookings. Nothing could set it except the booking flow
and CSV import. There is now a field on the job form with the shortfall said
out loud while the admin is still on the crew picker.

Still open: the doc also asks for a warning **before starting or completing** an
under-staffed job. Not built.

**#6 Client phone.** Already correct: the phone is excluded from available job
previews, and a `provider.showCustomerPhone` setting gates it even for assigned
cleaners. The doc asks whether masking is possible. **It is, now that Twilio is
connected**, and it was not before. Not built.

**#10 Per-cleaner pay.** Fully working for a fixed dollar amount per cleaner,
including a guarantee that the crew can never be paid more than the agreed
total. Percentage and hourly rates are job-level, not per-cleaner. The
BookingKoala screenshot shows a per-person `$ / % / hr` selector. Adding that
changes payroll maths and needs a decision. See section 6.

**#11 Preview panel.** Already carries contact rows, address, booking ID,
postal code, service, frequency, property, assignment, payment method, prices,
pay model, description and notes. Assignment was added this round. The one
field from the doc still missing is what each cleaner is being paid.

---

## 4. Road to October 10

Status against each block of `Road_to_October_10.pdf`.

| Dates | Work | Confirmed by | Status |
|---|---|---|---|
| Sept 2 to 5 | Email joins the conversation | An email inquiry answered end to end | Built, not proved |
| Sept 5 to 8 | The assistant learns to book | Genuine availability, staff can open a conversation | Done |
| Sept 8 to 10 | Follow-ups, then a full live test | September 10 deadline met | **At risk** |
| Sept 11 to 15 | Cleaner experience polish | Cleaner interface approved | Next |
| Sept 16 to 21 | Customer experience polish | Major interfaces complete | Not started |
| Sept 22 to 25 | Pricing decided and locked | Pricing locked | Client decision |
| Sept 22 to 28 | Subscriptions become real | A complete test subscription works | **Built early** |
| Sept 26 to 30 | Public website and ad tracking | Website complete | Pixel done, content pending |
| Oct 1 to 4 | Full funnel test | Funnel verified | Not started |
| Oct 5 to 8 | Final QA | Launch candidate | Not started |
| Oct 9 to 10 | Soft launch, then go live | Go live on October 10 | Not started |

### September 10 will be missed

Three tests were signed off for tomorrow. The code for all three is finished.
None can run, because all three sit behind configuration that has not arrived:

| Test | Blocked by |
|---|---|
| An email inquiry answered end to end | Resend inbound domain, `RESEND_INBOUND_SECRET`, `INBOUND_EMAIL_DOMAIN` |
| The assistant offers genuine availability | `ANTHROPIC_API_KEY` |
| Full end to end test passed | Both of the above, plus pointing the Twilio Messaging Service at us |

The client's own commitment in the plan reads: *"By September 8: AI access key,
so the live end-to-end test can run before the September 10 deadline."* That is
now two days late.

**This should be told to the client rather than discovered by them.**

### Time bought back

Subscriptions were the largest remaining build, scheduled Sept 22 to 28. They
are already written: checkout, billing portal, annual pricing, plan switching
with proration, dunning, trial reminder and expiry cron. What remains there is
testing with Stripe keys, not building. The Meta pixel half of Sept 26 to 30 is
also done.

That slack partly offsets the Sept 10 slip and is worth saying in the same
conversation.

---

## 5. Blocked on configuration, not code

Nothing in this section needs development work.

| Item | Blocks |
|---|---|
| `ANTHROPIC_API_KEY` in Vercel | All three Sept 10 tests. Overdue since Sept 8 |
| Resend inbound domain plus `RESEND_INBOUND_SECRET` and `INBOUND_EMAIL_DOMAIN` | The email leg. Ships dark until set |
| Twilio Messaging Service inbound URL pointed at us | Every inbound text. Currently goes to Octopods |
| `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` | The subscription webhook acknowledges and ignores until set |
| `NEXT_PUBLIC_META_PIXEL_ID` | No pixel loads until set |
| Notification toggles in Settings | Clocked out, photos, shift dropped, shift dropped urgent. Seeding never overwrites existing rows, so these stay off for Cleano and CleanoCalgary until switched on. The in-app centre shows the events regardless |
| Twilio balance, last seen 14.57 USD | Twilio fails messages quietly rather than going negative |
| Confirm the five Vercel crons are enabled | `/api/cron/subscriptions` is new and is what makes trials mean anything |

### Never tested against a real service

**Subscriptions have never run against a live Stripe account.** Signup, trial,
card, plan switch, failed payment and cancel are all written and typecheck, and
the money arithmetic is covered by tests, but no real card has ever gone
through this code. That is the single biggest untested risk before Oct 1.

---

## 6. Decisions needed

| Decision | Why it is blocked | Who |
|---|---|---|
| Per-cleaner percentage and hourly rates (#10) | Changes payroll maths. Fixed amounts already work | You |
| What a cleaner can report as an issue, and what happens next (#1) | The feature does not exist. Needs a shape before it can be built | You and client |
| Does a lapsed trial lose access? | Nothing gates access on subscription status today. `PAST_DUE` is informational. Making a cron switch customers off is not a decision to discover in production | You and client |
| Pricing: tiers, annual discount, launch offer, trial length | Scheduled Sept 22 to 25. `ANNUAL_MONTHS_CHARGED` is one line to change | Client |
| Website content, screenshots, FAQ answers | Scheduled Sept 26 | Client |
| HubSpot connector scope | Agreed for after Oct 10, one-way push | Client |

---

## 7. What is left to build

Ordered by what I would do first.

1. **Phone masking (#6).** Cleaner calls or texts the customer through the app,
   neither side sees the other's number. Possible now that Twilio is connected.
   Today every cleaner who has ever been assigned a job keeps that customer's
   mobile number permanently.
2. **Warn before starting or completing an under-staffed job (#4).** Small.
3. **Cleaner pay in the preview panel (#11).** Small.
4. **Cleaner experience polish**, Sept 11 to 15. The surface is already mature:
   mobile drawer, scroll lock, unread polling, browser notifications, wrapped
   tables. Rather than guess at polish, use the app on a phone and send what
   actually annoys you.
5. **Customer experience polish**, Sept 16 to 21.
6. **HubSpot connector**, after Oct 10.

---

## 8. Production cleanup, still outstanding

From the read-only audit, unchanged:

- 10 work sessions open for more than two days
- 4 jobs stuck in `IN_PROGRESS`, including #2150
- Two empty duplicate workspaces, `cleano` and `team-cleano`
- DMARC not set

---

## 9. What I would do next

**Today matters more than any feature.** Chase the API key. If it lands today,
all three Sept 10 tests can be proved tomorrow because the code is finished and
waiting. If it does not, tell the client the date moves and why, and say in the
same breath that subscriptions came in early.

After that, phone masking is the one substantial item left on the fix list that
needs neither a decision nor configuration.
