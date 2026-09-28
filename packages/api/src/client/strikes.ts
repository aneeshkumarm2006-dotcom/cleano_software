import { StrikesResponse } from "../v1/strikes";
import type { Request } from "./request";

export const strikesApi = (request: Request) => ({
  strikes: () => request("/api/v1/strikes", StrikesResponse),
});
