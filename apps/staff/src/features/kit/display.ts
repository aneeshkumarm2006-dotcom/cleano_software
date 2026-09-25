// How a kit item reads on screen. The judgement (is it low?) is the server's
// `attention`; this only turns it into words, a tone and a fill.
import type { KitItem, KitResponse } from "@bookmops/api/v1";

import { dayMonth } from "@/lib/dates";
import { quantityText, type Tone } from "@/features/record/ui";

export const isTool = (item: KitItem) => item.itemType === "REUSABLE_EQUIPMENT";

export function toneOf(item: KitItem): Tone {
  switch (item.attention.tone) {
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "critical":
      return "critical";
    default:
      return "neutral";
  }
}

/** "12 cloths", "1 bottle", with the unit as the office wrote it. */
export function amount(item: Pick<KitItem, "quantity" | "unit">): string {
  return `${quantityText(item.quantity)} ${item.unit}`;
}

/** The line under the name: what the number or the report says. */
export function subline(item: KitItem, timeZone: string): string {
  if (isTool(item)) {
    if (item.statusNote) return `“${item.statusNote}”`;
    if (item.statusUpdatedAt) return `Checked ${dayMonth(item.statusUpdatedAt, timeZone)}`;
    return item.quantity > 1 ? `${amount(item)} · condition not reported yet` : "Condition not reported yet";
  }
  if (item.attention.kind === "LEVEL" && item.statusUpdatedAt) {
    return `You reported it ${item.attention.label.toLowerCase()} on ${dayMonth(item.statusUpdatedAt, timeZone)}`;
  }
  return item.refillAt != null ? `${amount(item)} · restock at ${quantityText(item.refillAt)}` : amount(item);
}

const LEVEL_FILL: Record<string, number> = { FULL: 1, GOOD: 0.75, HALF: 0.5, LOW: 0.2, EMPTY: 0.04 };

/**
 * How full the bar is, 0 to 1, or null when a bar would mean nothing (a tool).
 * A reported level wins over the count, as on the web: nothing deducts from a
 * bottle's number any more, so the level is the honest signal.
 */
export function fill(item: KitItem): number | null {
  if (isTool(item)) return null;
  if (item.attention.kind === "LEVEL" && item.level && item.level !== "UNKNOWN") return LEVEL_FILL[item.level] ?? null;
  const scale = Math.max((item.refillAt ?? 1) * 2, 1);
  return Math.min(1, Math.max(0.04, item.quantity / scale));
}

/** A restock is for things that run out; a tool is repaired or replaced instead. */
export const canRestock = (item: KitItem) => !isTool(item);

/** For the More row and the header: consumables running low, and tools with a problem. */
export function kitCounts(kit: KitResponse | undefined) {
  const items = kit?.items ?? [];
  const low = items.filter((i) => i.attention.needsAttention && !isTool(i)).length;
  const tools = items.filter((i) => i.attention.needsAttention && isTool(i)).length;
  return { low, tools };
}

/** Top back up to twice the restock point, as the web suggests. At least one. */
export function suggestedRestock(item: KitItem): number {
  return Math.max(1, Math.ceil((item.refillAt ?? 1) * 2 - item.quantity));
}
