export type MissingEquipmentItem = {
  productId: string;
  productName: string;
  unit: string;
  needed: number;
  have: number;
  shortBy: number;
  /**
   * Where the requirement came from. TYPICAL_USAGE was USAGE_RULE until the
   * Inventory Rules settings were removed (awerfixes.pdf item 14) — it is now
   * the measured trailing-30-day average rather than a configured number.
   */
  source: "JOB_TYPE_KIT" | "ADD_ON" | "TYPICAL_USAGE";
};

export type EquipmentCheckResult = {
  jobId: string;
  clientName: string;
  jobDate: Date | null;
  jobType: string | null;
  addOns: string[];
  missing: MissingEquipmentItem[];
};
