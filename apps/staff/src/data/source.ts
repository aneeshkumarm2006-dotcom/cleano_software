// Where the app's data comes from.
//
// Screens never call fetch. They use the hooks in ./queries, which read from a
// DataSource: the real API in every build, or — in development builds only —
// sample data, so screens can be built and reviewed on a simulator before an
// account exists. Both implement the full client type from @bookmops/api, so a
// screen can't tell them apart and nothing changes when it moves between them.
import type { ApiClient } from "@bookmops/api/client";

export type DataSource = ApiClient;
