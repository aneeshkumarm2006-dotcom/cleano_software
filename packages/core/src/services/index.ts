// The public surface of @bookmops/core/services: every module in this folder.
// `export *` makes two modules exporting the same name a compile error,
// which is the point — a domain has one meaning per name.
export * from "./calendar-labels";
export * from "./service-catalog";
export * from "./service-content";
export * from "./service-permissions";
export * from "./service-pricing";
