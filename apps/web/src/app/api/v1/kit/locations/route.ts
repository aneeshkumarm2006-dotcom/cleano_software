// GET /api/v1/kit/locations — active storage locations, by name.
import { KitLocationsResponse } from "@bookmops/api/v1";

import { listKitLocations } from "@/server/kit/kit";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: KitLocationsResponse }, () => listKitLocations());
