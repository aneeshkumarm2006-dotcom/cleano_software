// The account's deletion request, in memory: sending one sticks while the
// preview is open, so the "Request sent" state can be checked on a simulator.
import type { DeletionRequestState } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

let state: DeletionRequestState = { pending: false, requestedAt: null };

export const previewAccountApi = {
  deletionRequest: () => delay(state),
  requestDeletion: async () => {
    await delay(null, 600);
    // One open request per person, as on the server: asking again answers with the first.
    if (!state.pending) state = { pending: true, requestedAt: new Date().toISOString() };
    return { requestedAt: state.requestedAt! };
  },
} satisfies Pick<DataSource, "deletionRequest" | "requestDeletion">;
