# Numbers that will move when this release deploys

**For:** Cleano — the owner and whoever reads the dashboards
**Date:** August 14, 2026
**Why you're reading it:** six pricing and pay defects are fixed in this
release. Fixing them changes figures you already know by heart. This document
lists every one of those figures **before and after**, measured against your
live database, so that nothing in next week's reports looks like a new bug.

Nothing here is an estimate. Every number was read from your production data on
August 14, 2026 (472 jobs) using the rates payroll actually uses — not a round
40% stand-in. Two of the numbers in our own earlier planning notes were the
round ones; where they differ, **this document is right and the planning note
was wrong**.

---

## The one-sentence version

The app has been showing you the **base service price** on screens that should
have been showing the **full job value**, and paying cleaners a percentage of
that same base price. Add-ons were invisible to both. From this release, one
number — base + add-ons + extra charges, or the override total on an imported
job — drives the price card, the Charge button, revenue, profit and cleaner pay
alike.

So: **revenue goes up, cleaner pay goes up, and the two move together.** Your
margin does not collapse; it was never as good as the report claimed on jobs
with add-ons, because the report was counting less revenue than you were
actually billing.

---

## 1. The three jobs from your screenshots

These are the exact jobs in the document you sent, found in your live data.

| | **#1826** silvana Cicerone | **#2031** Dan Mast | **#1809** Analyssa Paraskevopoulos |
|---|---|---|---|
| What's on it | $128 base + 2 × $29 grout | $100 base + $29 + 2 × $21 cabinets | $177, no add-ons (the "booking 6919" job) |
| **Price card** | $128.00 → **$186.00** | $100.00 → **$171.00** | $177.00 → $177.00 (no change) |
| **Charge button** | $128.00 → **$213.85** | $100.00 → **$196.61** | $177.00 → **$203.51** |
| **What was actually billed** | $213.85 all along | $196.61 all along | $203.51 all along |
| **Revenue counted** | $128.00 → **$186.00** | $100.00 → **$171.00** | unchanged |
| **Cleaner pay** | $58.88 → **$85.56** (Divanshu, 46%) | $48.00 → **$82.08** (Tanya, 48%) | $141.60 → unchanged, unless you act — see §3 |
| **Net profit on the job page** | $69.12 → **$100.44** | $52.00 → **$88.92** | $15.40 → **$35.40** |

Three things to notice:

- **The Charge button was lying in both directions.** It said $128 while Stripe
  took $213.85. That was never a billing error — the customer was charged the
  right amount — but the button told you the wrong one. It now shows exactly
  what the card will be charged, gift-card credit and deposit already deducted.
- **Profit goes UP on the two add-on jobs**, by $31.32 and $36.92, because the
  revenue those jobs were already earning is finally being counted.
- **#1809's profit rises $20.00** for a different reason: the $20 parking on it
  used to be subtracted from your profit even though the customer paid it. See
  §4.

---

## 2. How far this spreads across your data

| | |
|---|---|
| Jobs in the database | 472 |
| Jobs that carry any add-on today | **2** (#1826 and #2031, above) |
| Total job value currently invisible to the price card, revenue and pay | **$129.00** |
| Jobs carrying a tip or parking | **41** |
| Jobs already imported from BookingKoala | 0 flagged — see §3 |

**The historical impact is small; the forward-looking impact is not.** Only two
existing jobs carry add-ons, so the retroactive change to your reports is
$129.00 of revenue and about $61 of cleaner pay. Every job booked with add-ons
from the day this deploys is priced and paid correctly from the start — which is
the actual point.

---

## 3. Imported cleaner pay is now honoured — but only when you say so

Job #1809 carries a provider payment of **$88.55** from BookingKoala. Until now
the job page displayed it as "Stored value — not used", and paid the two
cleaners a full 40% each instead: **$70.80 each, $141.60 of labour on a $177
job**. That is the complaint in your document, and it is fixed.

**It does not change by itself.** The Employee pay field now has a
Manual / Automatic choice, and the Financials card offers "Use this amount" on
any stored figure that is being overridden. Until an admin clicks it on a given
job, that job pays exactly what it pays today.

We chose one click per job rather than a bulk stamp deliberately: 471 of your
472 jobs carry an `employeePay` value, and the overwhelming majority of those
are automatic estimates saved at booking time, not amounts anyone decided.
Flagging them all "manual" would have frozen your whole database at stale
numbers and called it your intent.

When you do mark #1809 manual, here is what the two cleaners are paid:

| | Viktoriia Lisovska | Ahmed Hamed Desoky Mohamed |
|---|---|---|
| Share of the $88.55 team total | $44.28 | $44.27 |
| Share of the $17.70 tip | $8.85 | $8.85 |
| Share of the $20.00 parking | $10.00 | $10.00 |
| **Total** | **$63.13** | **$63.12** |

Note the **$44.28 / $44.27**. Splitting an odd number of cents evenly is
impossible, so the split is cent-exact rather than rounded: one cleaner gets the
extra penny and the two shares add back to exactly $88.55. You will see one-cent
differences like this on any team total that doesn't divide evenly. It is not a
rounding bug.

---

## 4. Tips and parking are the customer's money, not yours

Both are collected from the customer and handed to the crew. Neither should ever
have touched your profit line. Two separate corrections:

**Parking — new.** It used to be subtracted from your profit as a company
expense, and no cleaner ever received it. It is now split evenly among the crew
on the job, exactly like a tip, and it stops reducing your profit.

**Tips — a reporting correction only.** Cleaners were already being paid tips
correctly. What was wrong is that the Analytics page **added** tips to your net
profit, booking your customers' gratuities as company earnings.

Across the 178 completed and paid jobs in your database:

| | |
|---|---|
| Tips that stop being counted as company profit | −$225.77 |
| Parking that stops being counted as a company cost | +$105.00 |
| **Net change to the Analytics "Net profit" figure** | **−$120.77** |

So the Analytics net profit number will drop by about $121 across all history,
and rise by the add-on revenue in §1. **This is a correction, not a loss** —
that $225.77 was your customers' money and was never yours to book.

**Nothing is recharged.** No historical invoice, charge or refund is reopened.
Going forward, an admin job saved with a tip or parking **before** it is charged
folds both into the card charge, so the money you hand the crew is money you
collected. If a tip or parking is entered on a job that has **already** been
paid, the job says so — the Financials card flags it as a pass-through owed but
not collected on the card, so you can collect it in cash or charge it manually.
The system will never quietly run a second charge on a customer's card.

---

## 5. What happens to payroll

- **Pay periods you have already generated keep their numbers.** A payout is
  written into the pay period when the period is created, and this release does
  not go back and rewrite them.
- **The next pay period you generate** picks up the two changes above: add-ons in
  the pay basis, and the parking share.
- **Discounts do not reduce cleaner pay.** A cleaner's basis is base + add-ons,
  before any discount. That matches how it already worked (the old basis ignored
  discounts too), so no cleaner's pay drops in the same release that raises it.
  Revenue, on the other hand, is still counted after the discount — a discount is
  your marketing spend, not a smaller job.
- **The one automatic model that did NOT change:** on a percentage job with no
  stored or manual team pay, every assigned cleaner still earns their own full
  rate. You retired the pooled split earlier this year and we have not
  reinstated it.

---

## 6. Two more surfaces worth knowing about

**Exports.** The jobs export used to hand your accountant the bare base price.
Its `Price` column is now the real job value, with new `Base Price` and `Add-ons`
columns beside it so the three reconcile on the page.

**Refunds.** The refund cap on job #1826 was $128 — of a charge that was
actually $213.85, so a full refund was impossible. Refunds are now capped at what
was really charged.

**Web bookings taken after this deploys.** Your revenue metric used to read a
web booking's tax-inclusive total and then subtract a discount that was already
inside it — inflated by the tax, reduced twice by the discount. It now reads the
pre-tax subtotal, which is what the metric always claimed to be. **No existing
row in your database is affected**; this applies to web bookings taken from here
on.

---

## 7. What we would like from you

1. **Nothing is blocking.** Every decision behind this release was made from
   evidence in your own data and your own earlier decisions, and each is written
   up in `CLIENT_DECISIONS.md` (D1 through D6) with the reasoning. Read them; if
   you disagree with any one of them, say so and we will change that one thing.
   None of them is load-bearing for the others.
2. **The two figures to sanity-check after deploy** are the Analytics net profit
   (down ~$121, §4) and the two add-on jobs' price cards (up $58 and $71, §1).
   If those two match, the release landed correctly.
3. **Job #1809 needs one click** if you want the $88.55 honoured (§3). Nothing
   else in your database needs any action.

---

*Every figure in this document was measured read-only against production on
August 14, 2026 by `scripts/probe-pricing-fixes.ts`. Re-run it any time to
reproduce the table in §1.*
