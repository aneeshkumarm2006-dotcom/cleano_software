import type {
  KitAddRequest,
  KitConditionRequest,
  KitCountRequest,
  KitIssueRequest,
  KitItem,
  KitPickupRequest,
  KitResponse,
  KitRestockRequest,
} from "@bookmops/api/v1";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const kitKeys = {
  kit: ["kit"] as const,
  catalog: ["kit", "catalog"] as const,
  locations: ["kit", "locations"] as const,
  location: (id: string) => ["kit", "locations", id] as const,
};

export function useKit() {
  const source = useSource();
  // Every screen of the kit reads this one query; the cleaner's own changes
  // update it directly, so a minute between refetches is only the office's.
  return useQuery({ queryKey: kitKeys.kit, queryFn: () => source.kit(), staleTime: 60_000 });
}

/** One item, read from the kit already loaded. */
export function useKitItem(productId: string) {
  const kit = useKit();
  return { ...kit, item: kit.data?.items.find((i) => i.productId === productId) ?? null };
}

export function useKitCatalog() {
  const source = useSource();
  return useQuery({ queryKey: kitKeys.catalog, queryFn: () => source.kitCatalog() });
}

export function useKitLocations() {
  const source = useSource();
  return useQuery({ queryKey: kitKeys.locations, queryFn: () => source.kitLocations(), staleTime: 10 * 60_000 });
}

export function useKitLocationProducts(locationId: string) {
  const source = useSource();
  return useQuery({ queryKey: kitKeys.location(locationId), queryFn: () => source.kitLocationProducts(locationId) });
}

/** Put the server's copy of one item into the loaded kit, then re-read it in the background. */
function applyItem(qc: QueryClient, item: KitItem) {
  qc.setQueryData<KitResponse>(kitKeys.kit, (prev) => {
    if (!prev) return prev;
    const exists = prev.items.some((i) => i.productId === item.productId);
    const items = exists ? prev.items.map((i) => (i.productId === item.productId ? item : i)) : [...prev.items, item];
    return { items, needsAttention: items.filter((i) => i.attention.needsAttention).length };
  });
  void qc.invalidateQueries({ queryKey: kitKeys.kit, exact: true });
}

export function useSetKitCount(productId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitCountRequest) => source.setKitCount(productId, body),
    onSuccess: (item) => applyItem(qc, item),
  });
}

export function useSetKitCondition(productId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitConditionRequest) => source.setKitCondition(productId, body),
    onSuccess: (item) => applyItem(qc, item),
  });
}

export function useReportKitIssue(productId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitIssueRequest) => source.reportKitIssue(productId, body),
    onSuccess: (item) => applyItem(qc, item),
  });
}

export function useAddKitItem() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitAddRequest) => source.addKitItem(body),
    onSuccess: (item) => {
      applyItem(qc, item);
      void qc.invalidateQueries({ queryKey: kitKeys.catalog });
    },
  });
}

export function useRequestRestock() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitRestockRequest) => source.requestRestock(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: kitKeys.kit, exact: true }),
  });
}

export function usePickUp() {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: KitPickupRequest) => source.pickUp(body),
    onSuccess: (_, body) => {
      void qc.invalidateQueries({ queryKey: kitKeys.kit, exact: true });
      void qc.invalidateQueries({ queryKey: kitKeys.catalog });
      void qc.invalidateQueries({ queryKey: kitKeys.location(body.locationId) });
    },
  });
}
