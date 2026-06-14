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
`--primary: #005F6A`, `--primary-deep`, `--primary-5/10/15/30/50/60/70`, `--cream`, `--ink`, `--emerald-*`, `--amber-*`, `--blue-*`, `--error`, `--shadow-soft`, `--font-serif`.

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
