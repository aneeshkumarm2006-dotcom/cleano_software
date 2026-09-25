// The public surface of @bookmops/core/inventory: every module in this folder.
// `export *` makes two modules exporting the same name a compile error,
// which is the point — a domain has one meaning per name.
export * from "./inventory-action";
export * from "./inventory-assign";
export * from "./inventory-issues";
export * from "./inventory-status";
export * from "./inventory-thresholds";
export * from "./item-type";
export * from "./kit-edit";
export * from "./wash";
