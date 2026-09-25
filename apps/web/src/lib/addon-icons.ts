// Spec item 22: add-ons render as icon cards (icon + name + price) in admin
// job creation and the client booking flow. Icons are inferred from the
// add-on's name by keyword — no schema change, and admin-created add-ons get
// a sensible icon automatically.
import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  CookingPot,
  Microwave,
  Refrigerator,
  WashingMachine,
  Shirt,
  Sofa,
  Wind,
  Grid3x3,
  Blinds,
  Brush,
  Footprints,
  Trees,
  Layers,
  PaintRoller,
  Box,
} from "lucide-react";

/**
 * The curated icon set an admin can pick from (item 17). Keys are stable
 * strings stored in the `pricing.addOns` catalog — never the component name, so
 * swapping the underlying lucide icon never invalidates saved catalogs.
 */
export const ADDON_ICONS = {
  sparkles: Sparkles,
  oven: CookingPot,
  microwave: Microwave,
  fridge: Refrigerator,
  laundry: Shirt,
  dryer: WashingMachine,
  sofa: Sofa,
  carpet: Layers,
  window: Blinds,
  patio: Trees,
  grout: Grid3x3,
  cabinet: Box,
  baseboard: Footprints,
  wall: PaintRoller,
  vent: Wind,
  brush: Brush,
} as const satisfies Record<string, LucideIcon>;

export type AddonIconKey = keyof typeof ADDON_ICONS;

export const ADDON_ICON_KEYS = Object.keys(ADDON_ICONS) as AddonIconKey[];
export const ADDON_ICON_KEY_SET: ReadonlySet<string> = new Set(ADDON_ICON_KEYS);

const RULES: Array<{ pattern: RegExp; icon: LucideIcon }> = [
  { pattern: /oven|stove/i, icon: CookingPot },
  { pattern: /microwave/i, icon: Microwave },
  { pattern: /fridge|refrigerator/i, icon: Refrigerator },
  { pattern: /laundry|folding|hanging/i, icon: Shirt },
  { pattern: /dryer|lint/i, icon: WashingMachine },
  { pattern: /couch|sofa|upholstery/i, icon: Sofa },
  { pattern: /carpet|rug/i, icon: Layers },
  { pattern: /window|track/i, icon: Blinds },
  { pattern: /patio|balcony|deck/i, icon: Trees },
  { pattern: /grout|tile/i, icon: Grid3x3 },
  { pattern: /cabinet/i, icon: Box },
  { pattern: /baseboard/i, icon: Footprints },
  { pattern: /wall|spot/i, icon: PaintRoller },
  { pattern: /vent|duct|air/i, icon: Wind },
  { pattern: /brush|scrub/i, icon: Brush },
];

/**
 * Resolve an add-on's icon.
 *
 * Accepts either a bare name (the original signature — every existing call site
 * keeps compiling) or the whole add-on, in which case an admin-chosen `icon`
 * key wins over the keyword guess.
 *
 * The keyword RULES are deliberately unchanged. They misfire in places —
 * `/vent|duct|air/` claims "Chair cleaning", "Stairs" and "Repair" — but
 * editing them would silently move icons on every existing catalog, and the
 * explicit key is now the escape hatch for exactly those cases.
 */
export function addonIcon(
  addOn: string | { name?: string | null; icon?: string | null }
): LucideIcon {
  const name = typeof addOn === "string" ? addOn : addOn?.name ?? "";
  const key = typeof addOn === "string" ? null : addOn?.icon;
  if (key && key in ADDON_ICONS) {
    return ADDON_ICONS[key as AddonIconKey];
  }
  for (const rule of RULES) {
    if (rule.pattern.test(name)) return rule.icon;
  }
  return Sparkles;
}
