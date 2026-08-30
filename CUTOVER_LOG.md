# Go-live log

A dated record of the work taking Awer from TeamCleano's single-tenant app to
multi-tenant SaaS in production. The **runbook** is `MULTI_TENANT.md`; the
**open security findings** are `SECURITY.md`. This file is the diary: what was
actually done, what was verified, and what it proved.

**Branch:** `multi-tenant` (local, unpushed) · **Production still serves `main`.**

---

## 2026-08-30 — the domain moved to Vercel DNS ✅ DONE

### What we did

1. Added `*.useawer.com` and `teamcleano.useawer.com` as domains on the Vercel
   project `cleano-software`.
2. Vercel offered **only one route** for a wildcard: move the nameservers. There
   was no `_acme-challenge` TXT or CNAME alternative to take instead.
3. Changed the nameservers at GoDaddy from `ns03/ns04.domaincontrol.com` to
   `ns1.vercel-dns.com` / `ns2.vercel-dns.com`. This needed a client OTP.

### Why the nameserver move was safe here

The move takes the whole DNS zone, which is normally where email breaks. It was
checked first, and the zone turned out to be nearly empty:

| Record | Before the move |
|---|---|
| **MX** | **none** — the domain receives no mail |
| SPF / apex TXT | none |
| DKIM (9 selectors probed) | none |
| Other subdomains (24 probed) | none |
| CAA | none — nothing that could block certificate issuance |
| DMARC | one record, GoDaddy's own default |

The decisive fact: the app sends mail **from `@teamcleano.com`**, a different
domain entirely. `useawer.com`'s DNS has nothing to do with outbound email, so
moving it could not break delivery.

### Verified afterwards

```
Certificate   CN = *.useawer.com
Issuer        Let's Encrypt
Valid         Aug 30 2026  →  Nov 28 2026

teamcleano.useawer.com       → HTTP 307 → /login
random-xyz-test.useawer.com  → HTTP 307 → /login     (wildcard genuinely serving)
www.useawer.com              → HTTP 307 → /login     (live site never went down)
useawer.com                  → HTTP 308 → www
```

The live site stayed up throughout, because both the old and new nameservers
pointed apex and www at the same Vercel project.

### Consequences worth remembering

- **Vercel renews the wildcard certificate itself** now that it owns the zone.
  No `_acme-challenge` record to maintain, and **no client OTP every 90 days** —
  which is what the alternative would have cost.
- Every subdomain currently serves TeamCleano's login page, because that is what
  the deployed code does. Per-company routing begins only when the new code ships.
- **The DMARC record did not survive the move.** Confirmed by querying Vercel's
  nameservers directly. Still to be recreated:

  | Type | Name | Value |
  |---|---|---|
  | TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |

  Nothing breaks today (no MX, and the app sends from another domain), but a
  domain with no DMARC is easier to spoof.

---

## 2026-08-30 — security hardening before cutover ✅ ALL FOUR FIXED

Context: the four findings in `SECURITY.md` are **not exploitable today**, because
production runs `main`, which has no notion of organizations. They go live the
moment the multi-tenant code ships. That is why they are being fixed before the
deploy rather than after it.

### ✅ Finding 1 — settings cache was shared across tenants (High)

`src/lib/settings/index.ts`

The read cache was a process-global `Map` keyed only by the setting key, while
the query underneath it had become org-scoped. Every tenant on an instance was
served the first tenant's values for the 30-second TTL.

The worst consumer was the deposit gate on the **unauthenticated** booking
endpoint: a workspace that set its own deposit to `0` would poison the shared
entry, and `submitBooking` on another workspace would then take `waived` and mint
real jobs with no payment and no card.

**Fixed by** keying every entry `<organizationId>:<settingKey>`:
- `getSetting` and `getSettings` resolve the org first and only read/write their
  own partition.
- When there is no tenant to attribute a read to, the cache is **not touched at
  all** rather than shared — values are fetched fresh and stored nowhere.
  Observable behaviour is unchanged, because the scoped query would fail without
  a tenant anyway and already degraded to the registry default.
- `getSettings` now also keeps what it fetched in a local map, so the merge step
  is correct in that no-tenant case instead of falling back to defaults.
- `invalidateSetting` became **async and org-aware** — busting a bare key would
  have cleared everyone else while leaving the writer stale. Both call sites
  (`writeSetting`, `updateAppSetting`) updated to await it.
- `invalidateAllSettings` still clears everything: broader than needed, never wrong.

### ✅ Finding 2 — a session from one workspace worked in another (High)

`src/lib/auth.ts`

The `customSession` plugin looked the user's role up through the **org-scoped**
client and answered a miss with `role: userProfile?.role ?? 'EMPLOYEE'`.

A miss does not mean "user with no role". It means **"not a member of the
workspace this host resolved to"** — and it was the only signal available,
because session validation itself is not tenant-bound (`Session` is a better-auth
internal, deliberately absent from `TENANT_MODELS`). So anyone holding any valid
session — a cleaner at another company, or a stranger on a free trial — was handed
a working cleaner's role in every other workspace. Every guard downstream checks
the role and never the membership.

**Fixed by** failing closed: a miss now returns `null`, which is no session at all.

Confirmed against the installed better-auth (1.3.27) that this is real and not a
guess — the plugin's endpoint ends in `return ctx.json(fnResult)` and already uses
`ctx.json(null)` itself for the unauthenticated case. The callback's TypeScript
type is narrower than its runtime, so the return carries a cast and a comment
explaining it. If a future version ever stopped honouring null, the fallback is a
session carrying no role, which every `isXRole()` guard still refuses.

### ✅ Finding 4 — the tenant could be chosen with a request header (Medium)

`src/lib/org.ts`, `src/lib/org-url.ts`

Both resolved the tenant as `h.get(ORG_SLUG_HEADER) ?? orgSlugFromHost(host)` —
the **inbound** header first. `proxy.ts` overwrites that header, but its matcher
skips `/api/*` and every path containing a dot, so on exactly those requests
nothing overwrote what the caller sent. Since `getOrgSlug` feeds `requireOrgId()`,
the scoped client *and* the RLS `set_config('app.current_org_id', …)` announcement,
both isolation layers moved to the attacker's chosen value together.

**Fixed by** deriving from the host only and no longer reading the header.

Nothing is lost: `proxy.ts:98` computes the value it stamps from that same host,
so on proxied paths the two always agreed. The now-unused imports were removed.

### ✅ Finding 3 — public signup joined an existing workspace (High)

`src/lib/auth.ts`

`emailAndPassword` is enabled with no `disableSignUp`, so better-auth's public
`POST /api/auth/sign-up/email` is live on every workspace subdomain, and the row it
creates is stamped with that host's `organizationId`. Signing up therefore *joins* an
existing company rather than creating one.

**The real bug was narrower than "signup exists".** Two flows legitimately call
`authClient.signUp.email` — the customer portal setup page and `/sign-up` — so
`disableSignUp: true` would have broken them. Checked instead what a signup actually
*became*: `role` defaults to `EMPLOYEE` in the schema, and EMPLOYEE is a **staff** role
that opens the cleaner app with that company's job list, client names, full street
addresses and prices. Meanwhile every legitimate staff-creation path — `provisionOrganization`
(OWNER), `createEmployee`, `hireApplicant`, `sendLoginInvites`, `inviteApplicantToPortal`,
`importCsv`, `runBookingKoalaImport` — sets `role` explicitly and goes through Prisma
directly, never through better-auth. So the schema default was reachable *only* by public
signup.

**Fixed by** making public signup mint a CUSTOMER instead: `role` is declared as a
better-auth additional field with `defaultValue: "CLIENT"` and `input: false`, backed by a
`databaseHooks.user.create.before` that forces the same value. Nothing else changes — the
portal setup flow already promoted to CLIENT a round-trip later, and now the account is
simply correct from the moment it exists.

**A fix that looked right and silently was not.** The `databaseHooks` hook *alone* did
nothing: better-auth's adapter strips fields it has not been told about, so the INSERT
omitted the column and Prisma's `@default(EMPLOYEE)` filled it back in. The probe caught it —
the first signup after the "fix" still came back `EMPLOYEE`. Declaring the additional field
is what makes it take.

### Verification

Every fix was proven against a dev server pointed at the **staging** database, using the two
seeded workspaces, rather than assumed. Full transcripts are in `SECURITY.md` →
*Fixes applied*. The headline results:

```
session replay:   own host -> session      other company's host -> null
header spoofing:  header ignored, host wins in both directions
signup role:      EMPLOYEE -> CLIENT, and "role":"OWNER" in the body is refused

verify-tenant-isolation   23/23      verify-access-requests    9/9
verify-tenant-runtime     11/11      verify-stripe-isolation  12/12
verify-provisioning       13/13      verify-host-routing      38/38

npx tsc --noEmit  clean        npm run build  exit 0
production organizationId columns: 0 (untouched)
```

Two suites could not run, and both were proven **not** to be regressions:
`verify-endpoint-auth` and `verify-console-isolation` hardcode a `teamcleano` slug while
staging is seeded as `teamcleano-demo` (sign-in returns 503 on a workspace that does not
exist — correct — and 200 on one that does); `verify-cleaner-pay` fails on a `server-only`
import under tsx, which reproduces identically in a worktree at `82303bd`.

Files touched:
```
src/lib/settings/index.ts
src/app/admin/actions/updateAppSetting.ts
src/lib/auth.ts
src/lib/org.ts
src/lib/org-url.ts
```

---

## 2026-08-30 — full production backup taken and verified ✅

PITR was **not** bought. The 7-day tier is $100/month (prorated hourly, so a
3-day window would have been ~$10), but it also requires upgrading the project to
a Small compute size, and changing compute size restarts the database. Decision:
take a verified dump instead.

```
/Users/premsaikilaru/awer-prod-backup-20260830-073003.dump
2.3 MB compressed · 11.8 MB of data · 137 TABLE DATA entries
```

**Contains real customer data** — 972 clients with names, addresses and phone
numbers. It lives in the home folder, deliberately NOT in the repo.

### Verified, not assumed

Every one of the **83 public tables holding rows** is present in the dump. The four
that looked missing are Supabase's own bookkeeping in other schemas
(`auth.schema_migrations`, `realtime.schema_migrations`, `storage.migrations`,
`supabase_migrations.schema_migrations`) — not app data, and Supabase recreates them.

Rows were then extracted from the dump file and counted against live:

| table | in dump | live |
|---|---|---|
| Client | 972 | 972 |
| Job | 300 | 300 |
| User | 234 | 234 |
| Invoice | 23 | 23 |
| EmailLog | 7883 | 7883 |
| JobPhoto | 586 | 586 |
| Contact | 725 | 725 |
| Alert | 2008 | 2008 |
| ActivityLog | 26310 | 26312 |

`ActivityLog` differing by two is correct, and was chased down rather than waved
away: the dump was taken at 02:00:03 UTC, and the `notifications` cron wrote rows
at 02:01:18 and 02:05:20 — after the snapshot. Exactly two.

**Restore-verification numbers** — if this backup is ever restored, these are what
to check: `Client=972 Job=300 User=234 Invoice=23`.

### What this changes

An earlier note in this log called PITR "the only item that cannot be fixed
afterwards". With a verified dump that is **no longer true** — the restore point
exists. Take a **fresh dump immediately before `migrate deploy`** as step zero of
the window; on a 43 MB database it takes seconds and covers the real risk.

What a dump still does not give you is recovery from a problem noticed days later
without losing everything since. That is a judgement call now, not a blocker.

### Incidental finding, relevant to the window

The `notifications` cron writes to the database **every ~5 minutes**. The window has
a 2-5 minute gap where writes fail, so a cron run landing inside it is likely, not
theoretical. Pausing the crons is not optional.

---

## Still to do before cutover

### Code (mine)
- [x] ~~Findings 1-4 in `SECURITY.md`~~ — all fixed and verified 2026-08-30.
- [ ] **Finish the tenant-isolation audit that was interrupted** — `db-scoped.ts`,
      the RLS migrations, `setup-app-role.sql` / `setup-app-grants.sql`, the
      per-org unique constraints. This layer has still never been reviewed, and
      everything else rests on it.
- [ ] Decide on `linkClientAccount` matching a customer by email alone — a stranger can
      register a known customer's address and inherit their client record. Pre-existing, and
      the fix (requiring email verification) changes the customer signup experience, so it is
      your call. Written up at the end of `SECURITY.md`.

### Yours
- [x] ~~Buy Supabase PITR~~ — declined (needs a Small-compute upgrade + restart).
      Replaced by a verified pg_dump; see the 2026-08-30 backup entry above.
- [ ] **Take a FRESH dump immediately before `migrate deploy`** — step zero of the window.
- [ ] **Generate `SECRETS_KEY`** — `openssl rand -hex 32`, kept somewhere durable.
      Lose it and every stored Stripe credential becomes unreadable.
- [ ] **Add the DMARC TXT** in Vercel DNS (above).
- [ ] **Tell the TeamCleano team**: the address becomes `teamcleano.useawer.com`,
      and everyone signs in once more. This single item decides whether cutover
      morning is quiet or a phone flood.
- [ ] Pick the window — a genuinely quiet hour, middle of the night in Canada.
- [ ] Two open decisions: the Team Cleano-branded photo on the marketing page, and
      `public/gift-cards/*.jpg` (8 images 404ing in production right now).

### Rehearsal
- [ ] **Take one real card payment end to end.** Never been done, and it is the
      largest untested thing in the project.
- [ ] One more migration rehearsal on staging against the final code.

### The window itself
Ordered steps are in `MULTI_TENANT.md` → *Going live — the ordered cutover*. The
order is not obvious and matters: the role is created **before** the migrations
(two of them REVOKE from it), the grants **after** them (migration-created tables
have none), and the deploy must be **built and waiting** so the gap where writes
fail is a promote and not a build.

---

## 2026-08-30 — nobody could sign in on a workspace address ✅ FIXED

Reported from the team as *"it says invalid origin"* while the sign-in page
itself loaded normally.

### What was happening

A POST to `/api/auth/sign-in/email` on `teamcleano.useawer.com` was answered:

```
HTTP 403  {"code":"INVALID_ORIGIN","message":"Invalid origin"}
```

better-auth refuses any state-changing request whose `Origin` header is not on
its trusted list. That list defaults to exactly one entry — the `baseURL` — and
`baseURL` in production resolves to `https://www.useawer.com`. Probed against
production, three requests told the whole story:

| POST to | with Origin | result |
|---|---|---|
| `www.useawer.com` | `https://www.useawer.com` | 401 — origin accepted |
| `www.useawer.com` | `https://teamcleano.useawer.com` | **403 Invalid origin** |
| `teamcleano.useawer.com` | `https://www.useawer.com` | 401 — origin accepted |

One host was trusted everywhere, and it was not any workspace's host. Every
cleaner, admin and customer signing in at their own address was refused.

### Why the page still loaded, and why our testing missed it

Two reasons, both worth remembering:

1. The check **skips GET entirely**. The sign-in page is a GET, so it rendered
   perfectly. Only the POST behind the button was refused. "I can see it" and
   "I can use it" were different questions.
2. The check only runs **when the request carries a cookie**
   (`if (useCookies && !skipCSRFCheck)`). Every verification we ran was curl
   with no cookie jar, so every one of them sailed past the check that a real
   browser hits. The same POST passes or fails depending on whether a cookie
   is attached.

That second point is the lesson: a curl that does not carry a cookie is not a
test of a login.

### The second bug behind the same cause

`baseURL` is also what better-auth builds emailed links from —
`` `${ctx.baseURL}/reset-password/${token}` `` — so every password reset and
every "set your password" staff invite pointed at `www`. Confirmed live:

```
GET https://teamcleano.useawer.com/api/auth/reset-password/<token>?callbackURL=%2Freset-password
→ 302 location: https://www.useawer.com/reset-password?error=INVALID_TOKEN
```

A TeamCleano cleaner following their invite landed on the platform front door,
where `db` is scoped to the platform organization and their user row is not
visible. `sendLoginInvites` is how staff get their first password, so this was
the other half of "the team cannot log in".

### The fix — `src/lib/auth.ts`, two changes

1. **`trustedOrigins` is now derived per request**: the host the request
   actually arrived on, and only that one. This is not a loosening. The `Origin`
   header is set by the browser and cannot be forged by a page on another site,
   so a form on `evil.com` still sends `Origin: https://evil.com` and is still
   refused — and so is one workspace posting at another's, which a wildcard
   like `*.useawer.com` would have allowed.
2. **`onRequestHost()` moves emailed links onto the request's host**, and makes
   the `callbackURL` travelling inside them absolute at the same time. The
   second half matters: better-auth resolves a *relative* callbackURL against
   the same stale `baseURL`, which is how a link opened on the right host still
   redirected to the wrong one.

Deliberately **not** fixed by setting `BETTER_AUTH_URL`: one variable can only
ever name one host, which is the bug, not the cure. The fix works whether or
not that variable is set — verified both ways.

### Verified

Against a server running the fix, on a real workspace subdomain, with
`BETTER_AUTH_URL` pinned exactly as production pins it:

| request | before | after |
|---|---|---|
| cleaner signing in on their own workspace | 403 Invalid origin | **401** — reaches the password check |
| a page on `evil.example.com` | 403 | **403** — still refused |
| one workspace posting at another's | 403 | **403** — still refused |
| reset link with an absolute callbackURL | n/a | lands on the **workspace** host |
| reset link with a relative callbackURL | lands on the pinned host | (no longer emitted) |

`npx tsc --noEmit` clean; production build clean.

### Still open, same root

`ctx.options.baseURL` is mutated once per instance and cached — better-auth
works it out from the first request an instance ever serves. Nothing in the
sign-in or reset paths depends on it any more, but anything added later that
reads `baseURL` will inherit the same trap.
