# What changes when the closing inventory report ships

**For:** Cleano — the owner and whoever reads the inventory and job P&L screens
**Date:** August 17, 2026
**Covers:** the inventory fixes document, item #2 ("replace estimated product
usage with a closing inventory report") and the reporting half of item #1.
**Decisions this records:** D2, D3 and D4 from `_ai_context/TODO.md`.

---

## The one-sentence version

Clock-out has stopped guessing how much product a job consumed, and started
asking the cleaner what actually changed — so three numbers you may have been
reading as measurements will stop appearing, because they were never measured.

---

## 1. What the app used to do

At clock-out, every cleaner was shown their kit and asked to pick a level of
usage per product:

| What they tapped | What the app recorded |
|---|---|
| Light use | 15 sprays → **18.75 ml** deducted |
| Medium use | 30 sprays → **37.50 ml** deducted |
| Heavy use | 50 sprays → **62.50 ml** deducted |

Nobody counts trigger pulls. "Light" was a feeling, 15 was a constant in the
code, and 1.25 ml per spray was another one. The product of those two numbers
was then:

1. **deducted from that cleaner's stock**, so their kit count drifted from
   reality a little more with every job;
2. **priced at the product's cost per unit** and posted to the job as a
   **supplies expense**, where it reduced that job's profit;
3. **fed into the low-stock alerts and the inventory forecast**, which is how an
   invented number ended up deciding when someone was told to go and restock.

None of that was anyone's fault on the ground. The cleaners answered honestly;
the question could not be answered accurately.

---

## 2. What it does now

At clock-out a cleaner sees one question — **"Any product levels changed?"** —
and two buttons.

- **No changes** finishes the job in one tap. Nothing is written. This is the
  common case, and it now costs one tap instead of a survey.
- **Update inventory** lists their kit, and they touch only what changed:
  - **liquids** report a level: Full / Good / Half / Low / Empty
  - **consumables** report a count, plus an optional Low / Empty / Missing /
    Damaged chip
  - **tools** report a condition: Available / Missing / Damaged / Needs
    replacement / Needs maintenance

Anything they don't touch is not submitted at all.

**Nothing is deducted automatically, ever.** A level or condition report moves
no quantity. A count report sets the number to what the cleaner says is there,
which is a recount, not a subtraction.

Anything reported as low, empty, missing, damaged or needing service raises a
flag in **Inventory → Needs Attention**, where you resolve it, dismiss it, or
turn it into a restock request in one click. The full history — cleaner, job,
item, previous status, new status, time, note — is on **Inventory → Activity**.

---

## 3. The numbers that will move

### 3.1 Per-job supplies cost disappears — decision **D2**

Every completed job used to get an automatic **SUPPLIES** transaction, sized by
the estimate above. It is no longer created.

- **Job profit goes UP** by whatever that line used to be, on every job from the
  deploy forward. On a typical residential clean the estimate was small — cents
  to a couple of dollars — but it was there on every single job.
- **Historic jobs are untouched.** Every supplies transaction already posted
  stays exactly where it is, so last month's reports do not move under you.
- **The expense itself has not gone away in real life** — you still buy product.
  It is now counted where the money actually leaves: when stock is purchased and
  brought into the warehouse. Supplies become a warehouse-level cost rather than
  a per-job apportionment of a guess.

**What we would like from you:** if you want per-job supplies cost back, the
honest version is to divide real purchase invoices across the period's jobs,
rather than to re-estimate per job. Say the word and we will cost it.

### 3.2 The Inventory Forecast tab is hidden — decision **D3**

The forecast projected "this cleaner needs N more litres over their next 6 jobs"
from the per-job usage figures above. With those gone, its 30-day window empties
out, every product projects zero, and the screen would quietly start telling you
everybody is fully stocked.

Rather than leave that up, both forecast surfaces — the Inventory tab and the
per-employee card — are hidden. **Nothing was deleted**: the maths, the screens
and the data are all still in the codebase behind a single switch
(`src/lib/inventory-forecast.flag.ts`), ready for the day something real feeds
them. The candidate is restock volume — how much of a product actually leaves
the warehouse per job worked — which is measured rather than estimated.

### 3.3 "Products used" on a job becomes history — decision **D4**

The **Products used** tab on a job, and the same table on the cleaner's job
page, read the old estimated rows. They are kept and still readable, labelled
**"Legacy estimated usage"**, so nothing you have already looked at vanishes.
Jobs worked from the deploy forward will show none, and say where to look
instead.

In **Inventory → Activity**, rows written before this release are labelled from
their own wording and marked as such; rows written after carry a stored, exact
verb. The estimated-usage rows specifically read **"Legacy estimated usage"**,
so a millilitre figure nobody ever measured is never mistaken for a count
somebody took.

---

## 4. What does NOT change

- **Cleaner pay, job pricing, invoices, deposits and payroll.** None of them
  ever read product usage.
- **Warehouse stock.** Clock-out never touched `Product.stockLevel`, and still
  doesn't. (The separate 8-vs-0 warehouse mismatch is item #5, and is its own
  piece of work.)
- **The clock-out checklist gate.** Required checklist items still block
  clocking out, exactly as before.
- **Reporting damage or loss from My Inventory.** Unchanged, including the
  write-off rules for lost and broken items.

---

## 5. What to watch in the first week

1. **Inventory → Needs Attention.** It starts empty and fills as cleaners report.
   If it stays empty for a week across a busy crew, that is worth a look — it
   more likely means people are tapping "No changes" out of habit than that
   nothing ever runs out.
2. **Job profit.** Slightly higher per job than the same job last month, by the
   supplies line that is no longer posted. Expected, not a bug.
3. **Cleaner kit counts.** They will stop drifting downward on their own. A count
   that looks too high is a count that was being eroded by the estimate before;
   fix it once from **Cleaner Inventory → Set quantity**, and from then on it
   only moves when someone actually moves stock.
