// Server-side reader for THE service catalog (awer_fixes.pdf item 20).
// The pure model lives in ./service-catalog so client pickers can share it.
import "server-only";
import { db } from "@/db";
import {
  SERVICE_CATALOG_KEY,
  normalizeServiceCatalog,
  serviceLabelMap,
  type ServiceCatalogEntry,
} from "./service-catalog";

/** The admin-configured service list, falling back to the shipped defaults. */
export async function getServiceCatalog(): Promise<ServiceCatalogEntry[]> {
  try {
    const setting = await db.appSetting.findUnique({
      where: { key: SERVICE_CATALOG_KEY },
    });
    return normalizeServiceCatalog(setting?.value);
  } catch {
    // Never block a page render because the settings read failed — the
    // defaults are always a valid catalog.
    return normalizeServiceCatalog(null);
  }
}

/** Catalog plus its category -> label map, for pages that need both. */
export async function getServiceCatalogWithLabels(): Promise<{
  catalog: ServiceCatalogEntry[];
  labels: Record<string, string>;
}> {
  const catalog = await getServiceCatalog();
  return { catalog, labels: serviceLabelMap(catalog) };
}
