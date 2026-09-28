// The real sender and store, and the one seam a test replaces them through.
import "server-only";

import type { PushDeps } from "./core";
import { expoSender } from "./expo";
import { prismaPushStore } from "./store";

const realDeps: PushDeps = {
  sender: expoSender,
  store: prismaPushStore,
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // Names and counts only: never a token, a name or a notification's text.
  log: (event, detail) => console.error(JSON.stringify({ at: event, ...detail })),
};

let override: PushDeps | null = null;

export function pushDeps(): PushDeps {
  return override ?? realDeps;
}

/** For tests: send through a fake. Pass null to restore the real sender. */
export function setPushDepsForTests(deps: PushDeps | null): void {
  override = deps;
}
