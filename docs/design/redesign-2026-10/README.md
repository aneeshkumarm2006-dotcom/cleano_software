# Bookmops redesign, October 2026

The source of the redesign canvas: 25 screens plus the shared sidebars and the colour tokens. The live, editable canvas is at https://claude.ai/artifact/WQMH5Wh2XYXggya4utY5gs (Share it from its Share menu before sending the link on).

These files are a snapshot for the record. Edit the canvas, not these files; the app's real code does not read them.

## Palette

| Token | Value | Used for |
|---|---|---|
| Sidebar | `#2B3337` | Admin and cleaner sidebars, customer top bar, phone tab bars |
| Accent | `#1B9ADB` | Chart bars, active tabs, icons, progress |
| Accent strong | `#077AB4` | Buttons and links (AA with white text) |
| Canvas | `#F4F7FB` | Page background |
| Border | `#E5EAF0` | Card and table borders |
| Ink | `#0F1B2A` | Main text |
| Muted | `#55657A` | Secondary text |

Status tags: Scheduled `#E0F2FE`/`#0369A1`, In progress `#FEF3C7`/`#92400E`, Completed `#DCFCE7`/`#15803D`, Unassigned `#FEE2E2`/`#B91C1C`, Cancelled `#F1F5F9`/`#475569`.

Type is Figtree in the canvas. Whether mobile keeps Gontserrat is still open.

## Screens

| Section | Files |
|---|---|
| Admin web | `Main` (dashboard), `Jobs`, `JobDetail`, `Calendar`, `Clients`, `Invoices`, `Messages`, `Employees` |
| Admin mobile | `AdminMobileToday`, `AdminMobileAssign`, `AdminMobileApprove` |
| Cleaner web | `CleanerDashboard`, `CleanerAvailable`, `CleanerPay` |
| Cleaner mobile | `MobileToday`, `MobileJob`, `MobileAvailable`, `MobilePay` |
| Customer web | `CustomerBook`, `CustomerBookings`, `CustomerBookingDetail` |
| Customer mobile | `MobileCustomerHome`, `MobileBook`, `MobileBookings`, `MobileOnTheWay` |
| Foundations | `Tokens`, `Sidebar`, `CleanerSidebar` |

All names, prices and numbers in the screens are sample data.
