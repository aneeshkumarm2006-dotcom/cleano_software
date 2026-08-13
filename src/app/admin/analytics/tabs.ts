// Analytics tab ids, shared by the server page and the client view so the
// `?tab=` round-trip and the filter's visibility rule can't drift apart.
//
// Six of the ten tabs have no industry or job-date dimension at all. If the
// filter control sat in the page header it would read as broken the first time
// someone picked Airbnb and inventory value didn't move (Q7 §5), so it is
// rendered only on the tabs whose numbers are computed off the jobs array.

export const ANALYTICS_TABS = [
  "overview",
  "kpis",
  "graphs",
  "budget",
  "targets",
  "inventory",
  "employees",
  "payments",
  "alerts",
  "marketing",
] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

/** Tabs whose figures come from the jobs array, so the filter changes them. */
export const FILTERABLE_TABS: ReadonlySet<AnalyticsTab> = new Set<AnalyticsTab>([
  "overview",
  "kpis",
  "graphs",
  "payments",
  "employees",
]);

export function isFilterableTab(tab: AnalyticsTab): boolean {
  return FILTERABLE_TABS.has(tab);
}
