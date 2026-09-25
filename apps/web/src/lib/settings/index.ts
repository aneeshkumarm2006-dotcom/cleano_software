/**
 * Server-side read/write layer over the settings registry.
 *
 * Readers across the app call `getSetting("policy.cancellationFeeUsd")` instead
 * of importing a hardcoded constant. Reads are typed by the registry, cached
 * briefly, and ALWAYS fall back to the registry default — a DB error or a
 * malformed stored value degrades to today's behavior, never to $0/free or an
 * unbounded value. Writes go through `writeSetting`, which validates, audits,
 * and busts the cache.
 *
 * Not a "use server" module: these are plain server helpers, not form actions.
 */

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";
import { writeAppSetting } from "@/lib/app-setting-write";
import { requireOrgId } from "@/lib/org";
import {
  findSettingDef,
  getSettingDef,
  type SettingKey,
  type SettingValue,
} from "./registry";

interface CacheEntry {
  value: unknown;
  expires: number;
}

/** Short TTL bounds cross-instance staleness; writes invalidate explicitly. */
const TTL_MS = 30_000;

/**
 * Cached values, keyed by `<organizationId>:<settingKey>`.
 *
 * The organization MUST be part of the key. This map lives for the life of the
 * process and is shared by every request that instance handles, while the read
 * below is org-scoped — so a bare setting key hands the first company's answer
 * to every other company for the length of the TTL. That is not only a leak of
 * business name, fees and gift-card tiers: `booking.standardDepositUsd` is what
 * `submitBooking` checks to decide whether a public booking needs a payment at
 * all, so one workspace setting its deposit to zero would let strangers book
 * another workspace for free.
 */
const cache = new Map<string, CacheEntry>();

const ck = (orgId: string, key: string) => `${orgId}:${key}`;

/**
 * The organization to attribute a cached read to, or null when there is none.
 *
 * Null means "do not touch the cache at all" rather than "share one". Callers
 * are unaffected: the scoped query below would fail without a tenant anyway,
 * and the existing catch already degrades that to the registry default.
 */
async function cacheOrg(): Promise<string | null> {
  try {
    return await requireOrgId();
  } catch {
    return null;
  }
}

/* --------------------------------- reads --------------------------------- */

/** Read one setting, typed by the registry. Falls back to the default. */
export async function getSetting<K extends SettingKey>(
  key: K
): Promise<SettingValue<K>> {
  const orgId = await cacheOrg();
  if (orgId) {
    const cached = cache.get(ck(orgId, key));
    if (cached && cached.expires > Date.now()) {
      return cached.value as SettingValue<K>;
    }
  }
  const def = getSettingDef(key);
  let value: SettingValue<K> = def.default;
  try {
    const row = await db.appSetting.findFirst({ where: { key } });
    if (row && row.value !== null && row.value !== undefined) {
      const parsed = def.validate(row.value);
      if (parsed.ok) value = parsed.value;
      else
        console.warn(
          `[settings] stored "${key}" failed validation (${parsed.error}); using default`
        );
    }
  } catch (e) {
    console.error(`[settings] read failed for "${key}"; using default`, e);
  }
  if (orgId) cache.set(ck(orgId, key), { value, expires: Date.now() + TTL_MS });
  return value;
}

/** Batch-read several settings; missing keys are fetched in a single query. */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[]
): Promise<{ [P in K]: SettingValue<P> }> {
  const orgId = await cacheOrg();
  const missing = orgId
    ? keys.filter((k) => {
        const c = cache.get(ck(orgId, k));
        return !(c && c.expires > Date.now());
      })
    : // No tenant to attribute a cached value to: read everything fresh and
      // store nothing, rather than borrowing another organization's entry.
      [...keys];

  // Values read in this call. Held locally as well as cached, so the merge
  // below still has them when there is no organization to cache them under.
  const fetched = new Map<K, unknown>();

  if (missing.length > 0) {
    try {
      const rows = await db.appSetting.findMany({
        where: { key: { in: missing as unknown as string[] } },
      });
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      for (const key of missing) {
        const d = getSettingDef(key);
        const raw = byKey.get(key);
        let value: unknown = d.default;
        if (raw !== undefined && raw !== null) {
          const parsed = d.validate(raw);
          if (parsed.ok) value = parsed.value;
          else
            console.warn(
              `[settings] stored "${key}" failed validation (${parsed.error}); using default`
            );
        }
        fetched.set(key, value);
        if (orgId) cache.set(ck(orgId, key), { value, expires: Date.now() + TTL_MS });
      }
    } catch (e) {
      console.error("[settings] batch read failed; using defaults", e);
    }
  }

  const out = {} as Record<K, unknown>;
  for (const key of keys) {
    if (fetched.has(key)) {
      out[key] = fetched.get(key);
      continue;
    }
    const cached = orgId ? cache.get(ck(orgId, key)) : undefined;
    out[key] = cached ? cached.value : getSettingDef(key).default;
  }
  return out as { [P in K]: SettingValue<P> };
}

/* --------------------------------- writes -------------------------------- */

export interface WriteSettingResult {
  success: boolean;
  error?: string;
}

/**
 * Validate + persist a registry setting, write an audit row for
 * audited/sensitive keys, and bust the cache. Returns a typed error on
 * validation failure. Called by the `updateAppSetting` action — not by client
 * code directly.
 */
export async function writeSetting(
  key: string,
  rawValue: unknown,
  actor: { id?: string | null; label?: string | null }
): Promise<WriteSettingResult> {
  const def = findSettingDef(key);
  if (!def) return { success: false, error: "Unknown setting" };

  const parsed = def.validate(rawValue);
  if (!parsed.ok) return { success: false, error: parsed.error };

  // Capture the prior value for the audit trail before overwriting.
  let oldValue: unknown;
  try {
    const existing = await db.appSetting.findFirst({ where: { key } });
    oldValue = existing?.value ?? def.default;
  } catch {
    oldValue = def.default;
  }

  await writeAppSetting(key, def.category, parsed.value as never);

  await invalidateSetting(key);

  if (def.audit || def.sensitive) {
    await logActivity({
      category: "ADMIN",
      action: "setting.update",
      actorId: actor.id ?? null,
      actorLabel: actor.label ?? null,
      targetType: "appSetting",
      targetId: key,
      message: `Updated setting: ${def.label}`,
      metadata: {
        key,
        oldValue,
        newValue: parsed.value,
        sensitive: !!def.sensitive,
      },
    });
  }

  return { success: true };
}

/* ------------------------------ cache control ----------------------------- */

/**
 * Drop one setting for the CURRENT organization.
 *
 * Async because it has to know which organization is writing. Busting the bare
 * key would leave this company reading a stale value while clearing everyone
 * else's — the invalidation has to be keyed the same way the read is.
 */
export async function invalidateSetting(key: string): Promise<void> {
  const orgId = await cacheOrg();
  if (orgId) cache.delete(ck(orgId, key));
}

/** Drop everything, for every organization. Broader than needed, never wrong. */
export function invalidateAllSettings(): void {
  cache.clear();
}

/** True when a key is governed by the settings registry. */
export function isRegisteredSetting(key: string): boolean {
  return findSettingDef(key) !== undefined;
}
