import { AvailabilityResponse, type DaysOffRequest, type WeekUpdateRequest } from "../v1/availability";
import { json, type Request, seg } from "./request";

export const availabilityApi = (request: Request) => ({
  availability: () => request("/api/v1/availability", AvailabilityResponse),
  setWeek: (body: WeekUpdateRequest) =>
    request("/api/v1/availability/week", AvailabilityResponse, json("PUT", body, body.clientEventId)),
  addDaysOff: (body: DaysOffRequest) =>
    request("/api/v1/availability/days-off", AvailabilityResponse, json("POST", body, body.clientEventId)),
  /** Deleting a range is idempotent by nature: a range with nothing left in it is not an error. */
  removeDaysOff: (from: string, to: string) =>
    request(`/api/v1/availability/days-off?from=${seg(from)}&to=${seg(to)}`, AvailabilityResponse, json("DELETE")),
});
