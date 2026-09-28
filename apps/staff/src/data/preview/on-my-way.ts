// Sample "On my way" state for development builds, held in memory so the
// button turns into "On your way" and stays that way.
import type { OnMyWayResponse } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

const sent = new Map<string, string>();

export const previewOnMyWayApi = {
  onMyWayState: (jobId) => delay({ sentAt: sent.get(jobId) ?? null, askForLocation: true }),
  markOnMyWay: (jobId, body) => {
    const before = sent.get(jobId);
    const sentAt = before ?? new Date().toISOString();
    sent.set(jobId, sentAt);
    const res: OnMyWayResponse = {
      sentAt,
      alreadySent: !!before,
      officeTold: !before,
      // j2's booking has client texts turned off, to show the other wording.
      clientTold: !before && jobId !== "j2",
      locationSaved: !!body.coords,
    };
    return delay(res, 600);
  },
} satisfies Pick<DataSource, "onMyWayState" | "markOnMyWay">;
