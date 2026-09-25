// The oldest and newest builds of each app (API_V1.md §3, "Keeping old builds
// honest"). A build below the minimum is answered 426 and shows a blocking
// "Please update" screen.
//
// The header is set by the app, so this is for experience, not security.
//
// Raising a minimum is a deploy-time decision (API_V1.md §12, decision 4 is
// still open): the defaults live here and an environment variable overrides
// each one without a code change.
import "server-only";

export interface AppVersions {
  minSupportedVersion: string;
  latestVersion: string;
}

const env = (name: string, fallback: string) => {
  const v = process.env[name]?.trim();
  return v && parseVersion(v) ? v : fallback;
};

export function appVersions(): { pro: AppVersions; customer: AppVersions } {
  return {
    pro: {
      minSupportedVersion: env("V1_PRO_MIN_VERSION", "1.0.0"),
      latestVersion: env("V1_PRO_LATEST_VERSION", "1.0.0"),
    },
    customer: {
      minSupportedVersion: env("V1_CUSTOMER_MIN_VERSION", "1.0.0"),
      latestVersion: env("V1_CUSTOMER_LATEST_VERSION", "1.0.0"),
    },
  };
}

/**
 * "1.2.3" or "1.2.3 (45)" (native version and build, as the apps send it) →
 * [1, 2, 3]. Null when it isn't one.
 */
export function parseVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw || raw.length > 40) return null;
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:\s*\(\s*[\w.-]{1,20}\s*\))?$/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isBelow(version: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== min[i]) return version[i] < min[i];
  }
  return false;
}
