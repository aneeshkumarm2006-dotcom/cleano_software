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

export function addonIcon(name: string): LucideIcon {
  for (const rule of RULES) {
    if (rule.pattern.test(name)) return rule.icon;
  }
  return Sparkles;
}
