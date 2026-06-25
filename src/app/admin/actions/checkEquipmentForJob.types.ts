export type MissingEquipmentItem = {
  productId: string;
  productName: string;
  unit: string;
  needed: number;
  have: number;
  shortBy: number;
  source: "JOB_TYPE_KIT" | "ADD_ON" | "USAGE_RULE";
};

export type EquipmentCheckResult = {
  jobId: string;
  clientName: string;
  jobDate: Date | null;
  jobType: string | null;
  addOns: string[];
  missing: MissingEquipmentItem[];
};
