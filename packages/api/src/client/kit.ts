import {
  type KitAddRequest,
  KitCatalogResponse,
  type KitConditionRequest,
  type KitCountRequest,
  type KitIssueRequest,
  KitItem,
  KitLocationProductsResponse,
  KitLocationsResponse,
  type KitPickupRequest,
  KitPickupResponse,
  KitResponse,
  type KitRestockRequest,
  KitRestockResponse,
} from "../v1/kit";
import { json, type Request, seg } from "./request";

// Every kit mutation carries the clientEventId made when the person tapped,
// as its idempotency key: a retry after a dropped connection must not recount,
// write stock off, or request a restock twice.
export const kitApi = (request: Request) => ({
  kit: () => request("/api/v1/kit", KitResponse),
  kitCatalog: () => request("/api/v1/kit/catalog", KitCatalogResponse),
  addKitItem: (body: KitAddRequest) => request("/api/v1/kit/items", KitItem, json("POST", body, body.clientEventId)),
  setKitCount: (productId: string, body: KitCountRequest) =>
    request(`/api/v1/kit/items/${seg(productId)}/count`, KitItem, json("PUT", body, body.clientEventId)),
  setKitCondition: (productId: string, body: KitConditionRequest) =>
    request(`/api/v1/kit/items/${seg(productId)}/condition`, KitItem, json("PUT", body, body.clientEventId)),
  reportKitIssue: (productId: string, body: KitIssueRequest) =>
    request(`/api/v1/kit/items/${seg(productId)}/issues`, KitItem, json("POST", body, body.clientEventId)),
  requestRestock: (body: KitRestockRequest) =>
    request("/api/v1/kit/requests", KitRestockResponse, json("POST", body, body.clientEventId)),
  kitLocations: () => request("/api/v1/kit/locations", KitLocationsResponse),
  kitLocationProducts: (locationId: string) =>
    request(`/api/v1/kit/locations/${seg(locationId)}/products`, KitLocationProductsResponse),
  pickUp: (body: KitPickupRequest) => request("/api/v1/kit/pickups", KitPickupResponse, json("POST", body, body.clientEventId)),
});
