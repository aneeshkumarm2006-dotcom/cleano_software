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
const cache = new Map<string, CacheEntry>();

/* --------------------------------- reads --------------------------------- */

/** Read one setting, typed by the registry. Falls back to the default. */
export async function getSetting<K extends SettingKey>(
  key: K
): Promise<SettingValue<K>> {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.value as SettingValue<K>;
  }
  const def = getSettingDef(key);
  let value: SettingValue<K> = def.default;
  try {
    const row = await db.appSetting.findUnique({ where: { key } });
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
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/** Batch-read several settings; missing keys are fetched in a single query. */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[]
): Promise<{ [P in K]: SettingValue<P> }> {
  const missing = keys.filter((k) => {
    const c = cache.get(k);
    return !(c && c.expires > Date.now());
  });

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
        cache.set(key, { value, expires: Date.now() + TTL_MS });
      }
    } catch (e) {
      console.error("[settings] batch read failed; using defaults", e);
    }
  }

  const out = {} as Record<K, unknown>;
  for (const key of keys) {
    const cached = cache.get(key);
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
    const existing = await db.appSetting.findUnique({ where: { key } });
    oldValue = existing?.value ?? def.default;
  } catch {
    oldValue = def.default;
  }

  await db.appSetting.upsert({
    where: { key },
    create: { key, category: def.category, value: parsed.value as never },
    update: { category: def.category, value: parsed.value as never },
  });

  invalidateSetting(key);

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

export function invalidateSetting(key: string): void {
  cache.delete(key);
}

export function invalidateAllSettings(): void {
  cache.clear();
}

/** True when a key is governed by the settings registry. */
export function isRegisteredSetting(key: string): boolean {
  return findSettingDef(key) !== undefined;
}
