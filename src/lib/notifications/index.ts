import { db } from "@/lib/org-db";
import { NOTIFICATION_CATALOG, type CatalogEntry, type Recipient, type Channel } from "./catalog";

export type { CatalogEntry, Recipient, Channel } from "./catalog";
export { NOTIFICATION_CATALOG } from "./catalog";

/**
 * Seed the NotificationSetting table from the static catalog.
 * Idempotent — existing rows keep their `enabled` value so admin
 * toggles are never overwritten. New rows are inserted with the
 * catalog defaults.
 */
export async function seedNotificationCatalog() {
  // Build the desired set of (recipient, key, channel) → defaults from the catalog.
  const desired: Array<{
    recipient: Recipient;
    category: string;
    key: string;
    label: string;
    trigger: string;
    channel: Channel;
    enabled: boolean;
    isProposed: boolean;
    sortOrder: number;
  }> = [];

  NOTIFICATION_CATALOG.forEach((entry: CatalogEntry, idx: number) => {
    (Object.entries(entry.channels) as [Channel, boolean][]).forEach(([channel, enabled]) => {
      desired.push({
        recipient: entry.recipient,
        category: entry.category,
        key: entry.key,
        label: entry.label,
        trigger: entry.trigger,
        channel,
        enabled,
        isProposed: entry.isProposed ?? false,
        sortOrder: idx,
      });
    });
  });

  // Pull existing rows so we know which to insert vs update-metadata.
  const existing = await db.notificationSetting.findMany({
    select: { recipient: true, key: true, channel: true },
  });
  const existingKey = (r: string, k: string, c: string) => `${r}::${k}::${c}`;
  const existingSet = new Set(existing.map((e) => existingKey(e.recipient, e.key, e.channel)));

  const toCreate = desired.filter(
    (d) => !existingSet.has(existingKey(d.recipient, d.key, d.channel))
  );

  if (toCreate.length > 0) {
    await db.notificationSetting.createMany({
      data: toCreate,
      skipDuplicates: true,
    });
  }

  // For rows that already exist, refresh metadata fields (category/label/trigger/
  // sortOrder/isProposed) but never touch `enabled`.
  for (const d of desired) {
    if (!existingSet.has(existingKey(d.recipient, d.key, d.channel))) continue;
    await db.notificationSetting.updateMany({
      where: { recipient: d.recipient, key: d.key, channel: d.channel },
      data: {
        category: d.category,
        label: d.label,
        trigger: d.trigger,
        sortOrder: d.sortOrder,
        isProposed: d.isProposed,
      },
    });
  }

  return { inserted: toCreate.length, total: desired.length };
}

// Pre-build a lookup of catalog defaults so we can fail-open against the
// PDF spec when the DB row hasn't been seeded yet. Without this, every
// notification silently no-ops until an admin visits Settings → Notifications.
const CATALOG_DEFAULTS = (() => {
  const m = new Map<string, boolean>();
  for (const entry of NOTIFICATION_CATALOG) {
    for (const [channel, enabled] of Object.entries(entry.channels)) {
      m.set(`${entry.recipient}::${entry.key}::${channel}`, !!enabled);
    }
  }
  return m;
})();

/**
 * Has the admin enabled this notification on this channel?
 *
 *  - If a DB row exists, that wins (admin toggles always take precedence).
 *  - Else if the static catalog has a default for this key, use that
 *    (treats the PDF spec as the source of truth before seeding).
 *  - Else (truly unknown key) fail-closed.
 */
export async function isNotificationEnabled(
  recipient: Recipient,
  key: string,
  channel: Channel
): Promise<boolean> {
  const row = await db.notificationSetting.findUnique({
    where: { recipient_key_channel: { recipient, key, channel } },
    select: { enabled: true },
  });
  if (row) return row.enabled;
  return CATALOG_DEFAULTS.get(`${recipient}::${key}::${channel}`) ?? false;
}
