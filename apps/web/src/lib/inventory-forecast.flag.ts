// Is the usage forecast worth showing? (TODO decision D3, Stage 3.)
//
// The forecast projects "this cleaner will need N more litres over their next 6
// jobs" from `JobProductUsage` — the per-job consumption cleaners reported at
// clock-out. Stage 3 stopped recording that, because what they were reporting
// was an estimate the app invented for them (Light use = 15 sprays × 1.25 ml),
// not a measurement. There is nothing dishonest about the projection MATHS; the
// input is simply gone.
//
// Leaving the surface up would have it quietly decay: the trailing 30-day
// window empties out, every product projects 0, and an admin reads "everyone is
// fully stocked for their upcoming jobs" off a table that has stopped being
// told anything at all. That is worse than no forecast, so both surfaces — the
// Inventory hub tab and the per-employee card — are hidden behind this one
// constant while the code stays exactly where it is.
//
// TO BRING IT BACK: flip this to `true` once something real feeds
// `loadPerJobAverages()` again. The candidate is restock/fulfilment volume
// (how much of a product actually leaves the warehouse per job worked), which
// is measured rather than estimated — and would need `inventory-forecast.ts`
// pointed at those rows instead. Nothing else has to change.
export const INVENTORY_FORECAST_ENABLED = false;
