// Where the app's data comes from.
//
// Screens never call fetch. They use the hooks in ./queries, which read from
// a DataSource: the real API in every build, or — in development builds only —
// a fixed set of sample data, so screens can be built and reviewed on a
// simulator before an account exists. The two implement the same contract
// types, so a screen can't tell them apart and nothing changes when it moves
// from one to the other.
import type { ApiClient } from "@bookmops/api/client";

export type DataSource = Pick<ApiClient, "me" | "today" | "jobs" | "job">;
