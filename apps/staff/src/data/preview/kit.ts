// Sample kit, storage locations and pickups for development builds, held in
// memory so a recount, a restock request or a pickup actually sticks. Item
// state is judged with the same rule the server uses (@bookmops/core), so the
// preview can't drift into showing a tool as "low".
import type { KitItem, KitLocationProductsResponse, KitResponse } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";
import { itemAttentionState, type EquipmentCondition, type ItemType, type LiquidLevel } from "@bookmops/core/inventory";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { once } from "./replay";

interface Row {
  productId: string;
  name: string;
  description: string | null;
  unit: string;
  itemType: ItemType;
  quantity: number;
  threshold: number;
  level: LiquidLevel | null;
  condition: EquipmentCondition | null;
  statusNote: string | null;
  statusUpdatedAt: string | null;
  updatedAt: string;
  pendingRequest: { quantity: number; requestedAt: string } | null;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const PRODUCTS: Omit<Row, "quantity" | "level" | "condition" | "statusNote" | "statusUpdatedAt" | "updatedAt" | "pendingRequest">[] = [
  { productId: "p-spray", name: "Multi-surface spray", description: "Citrus, 750 ml", unit: "bottles", itemType: "LIQUID", threshold: 1 },
  { productId: "p-cloths", name: "Microfibre cloths", description: null, unit: "cloths", itemType: "COUNTABLE_CONSUMABLE", threshold: 6 },
  { productId: "p-descaler", name: "Bathroom descaler", description: null, unit: "bottles", itemType: "LIQUID", threshold: 1 },
  { productId: "p-bags", name: "Vacuum bags", description: "For the Miele C1", unit: "bags", itemType: "COUNTABLE_CONSUMABLE", threshold: 3 },
  { productId: "p-vacuum", name: "Miele C1 vacuum", description: null, unit: "unit", itemType: "REUSABLE_EQUIPMENT", threshold: 0 },
  { productId: "p-scraper", name: "2-sided scraper", description: null, unit: "scraper", itemType: "REUSABLE_EQUIPMENT", threshold: 0 },
  { productId: "p-glass", name: "Glass cleaner", description: null, unit: "bottles", itemType: "LIQUID", threshold: 1 },
  { productId: "p-gloves", name: "Nitrile gloves", description: "Size M, box of 100", unit: "boxes", itemType: "COUNTABLE_CONSUMABLE", threshold: 1 },
  { productId: "p-liners", name: "Bin liners", description: null, unit: "rolls", itemType: "COUNTABLE_CONSUMABLE", threshold: 2 },
  { productId: "p-mop", name: "Flat mop", description: null, unit: "mop", itemType: "REUSABLE_EQUIPMENT", threshold: 0 },
];
const product = (id: string) => PRODUCTS.find((p) => p.productId === id)!;

function row(id: string, over: Partial<Row>): Row {
  return {
    ...product(id),
    quantity: 1,
    level: null,
    condition: null,
    statusNote: null,
    statusUpdatedAt: null,
    updatedAt: daysAgo(3),
    pendingRequest: null,
    ...over,
  };
}

let kit: Row[] = [
  row("p-spray", { quantity: 1, level: "LOW", statusUpdatedAt: daysAgo(1) }),
  row("p-cloths", { quantity: 12 }),
  row("p-descaler", { quantity: 1 }),
  row("p-bags", { quantity: 8 }),
  row("p-vacuum", { quantity: 1, condition: "AVAILABLE", statusUpdatedAt: daysAgo(12) }),
  row("p-scraper", { quantity: 1 }),
];

function toItem(r: Row): KitItem {
  const a = itemAttentionState({
    quantity: r.quantity,
    itemType: r.itemType,
    cleanerRestockThreshold: r.threshold,
    defaultThreshold: 1,
    condition: r.condition,
    levelStatus: r.level,
  });
  return {
    productId: r.productId,
    name: r.name,
    description: r.description,
    unit: r.unit,
    quantity: r.quantity,
    itemType: r.itemType,
    refillAt: r.itemType === "REUSABLE_EQUIPMENT" ? null : Math.max(r.threshold, 1),
    attention: { kind: a.kind, tone: a.tone, label: a.label, needsAttention: a.needsAttention },
    level: r.level,
    condition: r.condition,
    statusNote: r.statusNote,
    statusUpdatedAt: r.statusUpdatedAt,
    updatedAt: r.updatedAt,
    pendingRequest: r.pendingRequest,
  };
}

function kitResponse(): KitResponse {
  const items = [...kit].sort((a, b) => a.name.localeCompare(b.name)).map(toItem);
  return { items, needsAttention: items.filter((i) => i.attention.needsAttention).length };
}

function mine(productId: string): Row {
  const r = kit.find((k) => k.productId === productId);
  if (!r) throw new ApiError("This item isn't in your kit.", 404, "NOT_FOUND", false);
  return r;
}

function update(productId: string, patch: Partial<Row>): KitItem {
  mine(productId);
  kit = kit.map((k) => (k.productId === productId ? { ...k, ...patch, updatedAt: new Date().toISOString() } : k));
  return toItem(mine(productId));
}

const LOCATIONS = [
  { id: "loc-rosemont", name: "Rosemont warehouse", address: "5605 av. de Gaspé, Montréal" },
  { id: "loc-plateau", name: "Plateau locker", address: "4380 rue Saint-Denis (back door, code at the office)" },
];
const stock: Record<string, Record<string, number>> = {
  "loc-rosemont": { "p-spray": 24, "p-cloths": 140, "p-descaler": 9, "p-bags": 30, "p-glass": 12, "p-gloves": 6, "p-liners": 18, "p-mop": 2 },
  "loc-plateau": { "p-spray": 2, "p-cloths": 20, "p-descaler": 0, "p-bags": 4, "p-gloves": 1 },
};

export const previewKitApi = {
  kit: () => delay(kitResponse()),
  kitCatalog: () =>
    delay({
      items: PRODUCTS.filter((p) => !kit.some((k) => k.productId === p.productId)).map((p) => ({
        productId: p.productId,
        name: p.name,
        unit: p.unit,
      })),
    }),
  addKitItem: (body) =>
    once(body.clientEventId, () => {
      if (kit.some((k) => k.productId === body.productId)) {
        throw new ApiError("Already in your kit. Update the count instead.", 409, "ALREADY_IN_KIT", false);
      }
      kit = [...kit, row(body.productId, { quantity: body.quantity, updatedAt: new Date().toISOString() })];
      return toItem(mine(body.productId));
    }),
  setKitCount: (productId, body) => once(body.clientEventId, () => update(productId, { quantity: body.quantity })),
  setKitCondition: (productId, body) =>
    once(body.clientEventId, () => {
      if (mine(productId).itemType !== "REUSABLE_EQUIPMENT") {
        throw new ApiError("Condition is only for tools.", 409, "NOT_EQUIPMENT", false);
      }
      return update(productId, { condition: body.condition, statusNote: body.note ?? null, statusUpdatedAt: new Date().toISOString() });
    }),
  reportKitIssue: (productId, body) =>
    once(body.clientEventId, () => {
      const r = mine(productId);
      if (body.quantity > r.quantity) throw new ApiError(`You only have ${r.quantity} ${r.unit}.`, 409, "NOT_ENOUGH_IN_KIT", false);
      const condition =
        r.itemType === "REUSABLE_EQUIPMENT" ? (body.type === "LOST" ? "MISSING" : body.type === "BROKEN" ? "DAMAGED" : r.condition) : r.condition;
      return update(productId, { quantity: r.quantity - body.quantity, condition });
    }),
  requestRestock: (body) =>
    once(body.clientEventId, () => ({
      results: body.items.map((line) => {
        const r = mine(line.productId);
        if (r.pendingRequest) return { productId: line.productId, outcome: "ALREADY_PENDING" as const };
        update(line.productId, { pendingRequest: { quantity: line.quantity, requestedAt: new Date().toISOString() } });
        return { productId: line.productId, outcome: "CREATED" as const };
      }),
    })),
  kitLocations: () => delay({ items: LOCATIONS }),
  kitLocationProducts: (locationId) => {
    const location = LOCATIONS.find((l) => l.id === locationId);
    if (!location) return Promise.reject(new ApiError("This location isn't available.", 404, "NOT_FOUND", false));
    const res: KitLocationProductsResponse = {
      location,
      items: PRODUCTS.map((p) => ({
        productId: p.productId,
        name: p.name,
        description: p.description,
        unit: p.unit,
        available: stock[locationId]?.[p.productId] ?? 0,
      })),
    };
    return delay(res);
  },
  pickUp: (body) =>
    once(body.clientEventId, () => {
      const warnings: string[] = [];
      for (const line of body.items) {
        const p = product(line.productId);
        const on = stock[body.locationId] ?? {};
        const available = on[line.productId] ?? 0;
        if (available < line.quantity) {
          warnings.push(`${p.name}: ${available} ${p.unit} on record here, you took ${line.quantity}. The office will check the count.`);
        }
        on[line.productId] = available - line.quantity;
        const existing = kit.find((k) => k.productId === line.productId);
        if (existing) update(line.productId, { quantity: existing.quantity + line.quantity });
        else kit = [...kit, row(line.productId, { quantity: line.quantity, updatedAt: new Date().toISOString() })];
      }
      return { pickupId: `pickup-${Date.now()}`, warnings };
    }),
} satisfies Pick<
  DataSource,
  | "kit"
  | "kitCatalog"
  | "addKitItem"
  | "setKitCount"
  | "setKitCondition"
  | "reportKitIssue"
  | "requestRestock"
  | "kitLocations"
  | "kitLocationProducts"
  | "pickUp"
>;
