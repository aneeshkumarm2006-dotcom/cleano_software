// Which company this phone is signed in to, kept in secure storage so the app
// reopens straight into it — including with no signal.
import type { Workspace } from "@bookmops/api/v1";

import { secureStorage } from "./secure-storage";

const KEY = "bookmopspro.workspace";

export const workspaceStore = {
  load(): Workspace | null {
    const raw = secureStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const w = JSON.parse(raw) as Workspace;
      return w && typeof w.apiOrigin === "string" && typeof w.orgId === "string" ? w : null;
    } catch {
      return null;
    }
  },
  save(w: Workspace): void {
    secureStorage.setItem(KEY, JSON.stringify(w));
  },
  clear(): Promise<void> {
    return secureStorage.removeItem(KEY);
  },
};
