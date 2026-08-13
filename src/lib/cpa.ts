// Server-side CPA / lead-source reporting. Funnel metrics are derived live from
// the real Contact set (source → channel, lifecycle, paid bookings); spend comes
// from the AdSpendImport table. True CPA = spend ÷ first-cleaning customers.
import "server-only";
import { db } from "@/db";
import { listContacts } from "@/lib/crm";
import { addStoreMonths, formatDate, startOfStoreMonth } from "@/lib/timezone";
import {
  CHANNELS,
  channelFromSource,
  channelMeta,
  type CpaRow,
  type CpaTotals,
  type CpaReport,
  type TrendPoint,
  type SpendImport,
} from "@/lib/cpa-meta";

type Funnel = { leads: number; booked: number; firstClean: number; returning: number };

function emptyFunnel(): Funnel {
  return { leads: 0, booked: 0, firstClean: 0, returning: 0 };
}

export async function getCpaReport(): Promise<CpaReport> {
  const [contacts, spendRows] = await Promise.all([
    listContacts(),
    db.adSpendImport.findMany({ orderBy: { date: "desc" } }),
  ]);

  // ── Funnel per channel from real contacts ──
  const funnels = new Map<string, Funnel>();
  CHANNELS.forEach((c) => funnels.set(c.id, emptyFunnel()));
  for (const c of contacts) {
    const ch = channelFromSource(c.source);
    const f = funnels.get(ch) ?? emptyFunnel();
    f.leads += 1;
    if (c.bookings > 0) f.booked += 1;
    if (c.lifetimeValue > 0) f.firstClean += 1;
    if (c.lifecycle === "RETURNING") f.returning += 1;
    funnels.set(ch, f);
  }

  // ── Spend per channel ──
  const spendByChannel = new Map<string, number>();
  for (const s of spendRows) {
    spendByChannel.set(s.channel, (spendByChannel.get(s.channel) ?? 0) + s.amount);
  }

  const rows: CpaRow[] = CHANNELS.map((c) => {
    const f = funnels.get(c.id) ?? emptyFunnel();
    const spend = spendByChannel.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      paid: c.paid,
      color: c.color,
      ...f,
      spend,
      conv: f.leads ? f.booked / f.leads : 0,
      cpa: f.firstClean && spend > 0 ? spend / f.firstClean : c.paid && spend > 0 ? spend : null,
      cpl: f.leads && spend > 0 ? spend / f.leads : null,
      retRate: f.firstClean ? f.returning / f.firstClean : 0,
    };
  }).filter((r) => r.leads > 0 || r.spend > 0); // hide empty channels

  const totals: CpaTotals = rows.reduce(
    (t, r) => {
      t.spend += r.spend;
      t.leads += r.leads;
      t.booked += r.booked;
      t.firstClean += r.firstClean;
      t.returning += r.returning;
      return t;
    },
    { spend: 0, leads: 0, booked: 0, firstClean: 0, returning: 0, conv: 0, cpa: 0 } as CpaTotals
  );
  totals.conv = totals.leads ? totals.booked / totals.leads : 0;
  totals.cpa = totals.firstClean ? totals.spend / totals.firstClean : 0;

  // ── Trend: last 6 months (approximate — contact createdAt + import dates) ──
  const trend: TrendPoint[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    // Store-timezone month boundaries — this runs on the host (UTC), where
    // `new Date(y, m, 1)` is 8 PM on the last day of the previous month in
    // Montréal, so contacts created that evening fell in the wrong bucket.
    const d = startOfStoreMonth(addStoreMonths(now, -i));
    const next = startOfStoreMonth(addStoreMonths(now, -i + 1));
    const inMonth = (iso: string | Date) => {
      const t = new Date(iso);
      return t >= d && t < next;
    };
    const bookings = contacts.filter((c) => c.bookings > 0 && inMonth(c.createdAt)).length;
    const firstCleanM = contacts.filter((c) => c.lifetimeValue > 0 && inMonth(c.createdAt)).length;
    const spendM = spendRows.filter((s) => inMonth(s.date)).reduce((a, s) => a + s.amount, 0);
    trend.push({
      name: formatDate(d, { month: "short" }),
      bookings,
      cpa: firstCleanM ? Math.round(spendM / firstCleanM) : 0,
    });
  }

  const imports: SpendImport[] = spendRows.slice(0, 12).map((s) => ({
    id: s.id,
    channel: s.channel,
    channelName: channelMeta(s.channel).name,
    date: s.date.toISOString(),
    amount: s.amount,
    source: s.source,
  }));

  return { rows, totals, trend, imports };
}
