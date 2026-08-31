# Cleano Design System — Inventory

A living catalog of every UI primitive in the app, for redesign work.

**Live gallery:** run the app and visit **`/design`** — every admin atom renders on one page ([src/app/design/page.tsx](src/app/design/page.tsx)).

There are three layers:
1. **React components** — `src/components/ui/` + `src/components/customer/`
2. **Admin CSS atoms** — `src/app/globals.css`
3. **Customer CSS system** (`cl-`) — `src/app/customer.css` (portal/book/login — already polished)

---

## 1. React component primitives — `src/components/ui/`

| Component | Purpose |
|---|---|
| `Button.tsx` | Buttons (variants: default/primary/secondary/ghost/destructive/action) |
| `Badge.tsx` | Status badge (React) |
| `Card.tsx` | Container card |
| `Input.tsx`, `Textarea.tsx` | Text fields |
| `Select.tsx`, `PremiumSelect.tsx`, `SearchableDropdown.tsx`, `Dropdown.tsx`, `custom-dropdown.tsx` | Dropdowns ⚠️ **5 variants — consolidate** |
| `Checkbox.tsx` | Checkbox |
| `IconButton.tsx` | Icon-only button |
| `Modal.tsx`, `NotificationModal.tsx` | Dialogs |
| `Toast.tsx` | Toasts |
| `DatePicker.tsx`, `TimePicker.tsx` | Date/time pickers |
| `ColorPicker.tsx` | Color picker |
| `Chart.tsx`, `RingChart.tsx` | Charts |
| `CleanoLoader.tsx` | Branded spinner |
| `InitialsDropdown.tsx`, `SearchableTemplateSelector.tsx` | Specialized pickers |

**Customer-side** (`src/components/customer/`): `Field.tsx`, `Modal.tsx`, `SplitShell.tsx`, `PortalShell.tsx`, `Logo.tsx`, `atoms.tsx`, `DatePicker.tsx`

---

## 2. Admin CSS atoms — `src/app/globals.css`

The small reusable building blocks (redesign targets):

| Atom | Classes | Line |
|---|---|---|
| **Avatars** | `.avatar`, `.avatar-lg`, `.avstack` | 805 |
| **Pills/badges** | `.pill`, `.pill-emerald`, `.pill-amber`, `.pill-rose`, `.pill-dot` | 797 / 4624 |
| **Buttons** | `.btn`, `.btn-primary/secondary/ghost/danger-ghost`, `.btn-sm/lg/block`, `.icon-btn` | 1063 |
| **Inputs/forms** | `.input`, `.aselect`, `.field`, `.input-label`, `.checkbox` | 411 / 722 |
| **Typography** | `.eyebrow`, `.display`, `.subtitle`, `.title-sm`, `.section-title`, `.label`, `.text-xxxs…text-xl`, `.link`, `.link-muted` | 1032 |
| **Spacing** | `.stack-4/6/8/12/16/20/24/32`, `.row`, `.row-between`, `.grid-2`, `.grid-3` | 1044 |
| **Stat tiles** | `.astat`, `.astat-grid/head/icon/value/delta` | 667 |
| **Tables** | `.atable`, `.atable-wrap`, `.atable-scroll` | 769 |
| **Tabs** | `.atabs`/`.atab`/`.atab-count`; `.dtabs`/`.dtab`; `.tswitch` | 694 / 886 |
| **Toolbar/filters** | `.atoolbar`, `.atoolbar-search`, `.afilter-panel/toggle/badge` | 715 / 731 |
| **Cards** | `.dcard` (detail), `.jcard` (job) ⚠️ two styles | 907 / 853 |
| **Pagination** | `.apager`, `.apager-btn`, `.apager-controls` | 834 |
| **Banners** | `.banner`, `.banner-amber` | 658 |
| **Timeline** | `.timeline`, `.tline-item/dot/actor/text/ts` | 1013 |
| **Pay icons** | `.pay-icons`, `.pay-icon` (paid/unpaid/sent/unsent) | 822 |
| **Quick actions** | `.dash-qa`, `.dash-qa-icon/text/label/sub/arrow` | 4523 |
| **Animation** | `.fade-up`, `.fade-up-2`, `.equalizer-bar` | 1086 |

### Design tokens (CSS variables, `:root` in globals.css)
`--primary: #005F6A`, `--primary-deep`, `--primary-5/10/15/30/50/60/70`, `--cream`, `--ink`, `--emerald-*`, `--amber-*`, `--blue-*`, `--error`, `--shadow-soft`, `--font-app`, `--font-serif`.

### Typography (CLN-P1-8-*)

**One family, everywhere: `--font-app` (Montserrat).** It is set on `body` and inherited by admin, cleaner, customer, public booking and login. There is nothing to opt into — do **not** add a font-family to a new page or component.

Retired, and why the aliases still exist:

| Was | Where | Now |
|---|---|---|
| TT Norms Pro | `!font-tt-norms-pro` on `<body>` — an `!important` that beat every other rule | removed; the `@font-face` blocks and Tailwind tokens stay but nothing applies them |
| Manrope | `--font-cl` (customer/cleaner), double-loaded via next/font **and** a CDN `@import` | `--font-cl` → `--font-app`; the CDN import now loads only JetBrains Mono |
| Fraunces (serif italics) | `--font-serif`, `--font-cl-serif`, `.admin-page-title`, hardcoded in `join-waitlist` | all repointed to `--font-app`; the aliases remain so ~70 rules and a dozen inline styles didn't each need editing |

**Roles** — pick one, don't invent a size. Tokens are `--type-<role>-size` / `--type-<role>-weight` in `:root`:

| Role | Token prefix | Serving class |
|---|---|---|
| Main page title | `--type-page-title-*` | `.display`, `.admin-page-title`, `.cl-display` |
| Section heading | `--type-section-*` | `.title-sm`, `.section-title` |
| Subsection heading | `--type-subsection-*` | `.dcard-head h3` |
| Body text | `--type-body-*` | inherited |
| Labels | `--type-label-*` | `.label`, `.eyebrow`, `.cl-label` |
| Input text | `--type-input-*` | `.input`, `.textarea`, `.select` |
| Button text | `--type-button-*` | `.btn`, `.cl-btn` |
| Table heading | `--type-table-head-*` | `.atable thead` |
| Table content | `--type-table-cell-*` | `.atable tbody` |
| Helper text | `--type-helper-*` | field hints |
| Error / success | `--type-status-*` | `.banner-error`, `.banner-success` — colour distinguishes them, not size |
| Navigation | `--type-nav-*` | `.anav-item`, `.cl-snav-item` |

**Italics** are for intentional emphasis only. The decorative `<em>` accents in headings are upright and carry their accent through colour. Nothing renders below 12px.

---

## 3. CSS feature modules (page-specific, namespaced)

Whole-feature stylesheets, not atoms:

- **Sidebar:** `.asidebar-*`, `.anav-item`, `.cl-snav-*`, `.cl-sidebar-dark`
- **Analytics/KPI:** `.an-*`, `.k-*`
- **Chat:** `.chat-*`
- **Calendar:** `.cl-cal-*`, `.cl-agenda-*`
- **Cleaner app:** `.cl-dash-*`, `.cl-jd-*`, `.cl-job-card-*`, `.cl-jobs2-*`, `.cl-pay-*`, `.cl-inv-*`, `.cl-rw-*`/`.cl-rag-*`
- **Clock in/out:** `.clk-*`, `.clo-*`
- **Checkout/inventory:** `.co-*`, `.cl-co-*`, `.pju-*`
- **Requests:** `.req-*`
- **Training:** `.cl-quiz-*`, `.cl-module-*`, `.cl-video-*`
- **Dashboard lists:** `.dash-*`

---

## Canonical components (from the design handoff)

These are the official "winners" — build new code against these, migrate old usages onto them, then delete the alternates.

| Primitive | Canonical | Status | Replaces |
|---|---|---|---|
| Avatars | [`avatarColor()` / `initials()`](src/lib/avatar.ts) | ✅ built | 6 divergent `avatarColor` copies |
| Page header | [`<PageHeader>`](src/components/ui/PageHeader.tsx) | ✅ built | 4 hand-rolled blocks |
| Dropdown | [`<CanonSelect>`](src/components/ui/CanonSelect.tsx) | ✅ built | `Select`, `PremiumSelect`, `SearchableDropdown`, `Dropdown`, `custom-dropdown` |
| Loader | [`<CleanoLoader>`](src/components/ui/CleanoLoader.tsx) | ✅ built (droplet) | — |
| Buttons | `.btn` CSS | use existing | `Button.tsx`, `.act-*`, `FilterStat` |
| Pills | `.pill` CSS | use existing | `Badge.tsx`, `STATUS_PILL`, inline hex |
| Cards | `.dcard` CSS | use existing | `Card.tsx`, `.jcard` |

All seven are rendered with their canonical badge in the [`/design`](src/app/design/page.tsx) gallery.

### Rollout still pending (per-page migration)
The canonical components exist but old usages haven't been swapped yet:
- Replace the ~6 local `avatarColor` definitions with the shared import.
- Swap page headers onto `<PageHeader>`.
- Migrate the 5 dropdown components onto `<CanonSelect>`, then delete them.
