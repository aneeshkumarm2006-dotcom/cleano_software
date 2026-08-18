"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  ChevronDown,
  Package,
  Loader,
  Eye,
  Pencil,
  Plus,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Boxes,
  AlertTriangle,
  DollarSign,
  Users,
  Trash2,
  Tag,
  Gauge,
  RotateCcw,
  ExternalLink,
  Layers,
} from "lucide-react";
import Link from "next/link";
import { LOW_STOCK_LABEL } from "@/lib/inventory-thresholds";
import {
  ITEM_TYPES,
  ITEM_TYPE_LABEL,
  ITEM_TYPE_NAME,
  type ItemType,
} from "@/lib/item-type";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import CustomDropdown from "@/components/ui/custom-dropdown";
import ImportCsvButton from "@/components/csv/ImportCsvButton";
import { fmtDateTime } from "@/lib/time";
import { sanitizeHttpUrl } from "@/lib/safe-url";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { bulkSetProductCategory } from "../actions/bulkSetProductCategory";
import { bulkSetProductItemType } from "../actions/bulkSetProductItemType";
import { bulkSetProductMinStock } from "../actions/bulkSetProductMinStock";

const CATEGORY_OPTIONS: Array<{ value: ProductCategory; label: string }> = [
  { value: "LIQUID_SPRAY", label: "Liquid Spray" },
  { value: "MOP_LIQUID", label: "Mop Liquid" },
  { value: "DISPOSABLE", label: "Disposable" },
  { value: "OTHER", label: "Other" },
];

type ProductCategory = "LIQUID_SPRAY" | "MOP_LIQUID" | "DISPOSABLE" | "OTHER";

/**
 * Item-type chip. Says at a glance whether a row is a liquid, a countable
 * consumable, or a tool — i.e. whether the refill thresholds on the same row
 * mean anything at all (inventory fixes PDF #1 + #4).
 */
function ItemTypeChip({ itemType }: { itemType?: ItemType }) {
  if (!itemType) return null;
  return (
    <Badge
      variant={itemType === "REUSABLE_EQUIPMENT" ? "tdo" : "cleano"}
      size="xs"
      className="shrink-0"
      title={ITEM_TYPE_NAME[itemType]}>
      {ITEM_TYPE_LABEL[itemType]}
    </Badge>
  );
}

/**
 * Outbound "buy again" icon. Renders the primary purchase link, falling back to
 * the first additional link. The stored URL is re-sanitized here — an href is
 * only ever emitted for an http(s) URL, so a bad row can't become script — and
 * carries rel="noopener noreferrer" so the opened tab can't touch window.opener.
 */
function BuyLink({
  product,
}: {
  product: { purchaseUrl: string | null; links: Array<{ label: string; url: string }> };
}) {
  const href =
    sanitizeHttpUrl(product.purchaseUrl) ??
    sanitizeHttpUrl(product.links[0]?.url) ??
    null;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Open purchase link"
      aria-label="Open purchase link"
      className="shrink-0 text-[#008C9C]/50 hover:text-[#008C9C]">
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
  category?: ProductCategory;
  itemType?: ItemType;
  stockUpdatedAt: string | null;
  stockUpdatedByName: string | null;
  purchaseUrl: string | null;
  links: Array<{ label: string; url: string }>;
  totalAssigned: number;
  employeeCount: number;
  totalInventory: number;
  isLowStock: boolean;
}

interface InventoryViewProps {
  products: Product[];
  isLoading: boolean;
  // Search and filters
  searchTerm: string;
  statusFilter: string;
  rowsPerPage: number;
  page: number;
  // Handlers
  onSearchTermChange: (term: string) => void;
  onStatusFilterChange: (filter: string) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onPageChange: (page: number) => void;
  onViewProduct: (product: Product) => void;
  onEditProduct: (product: Product) => void;
  onAddProduct: () => void;
  // Stat-card actions (wired to sibling tabs / filters in the parent)
  onShowCleanerInventory?: () => void;
  onShowLowStock?: () => void;
  onClearFilters?: () => void;
  // URL update function
  updateURLParams: (updates: Record<string, string | number>) => void;
  // Archived (soft-deleted) view
  archived?: boolean;
}

export default function InventoryView({
  products,
  isLoading,
  searchTerm,
  statusFilter,
  rowsPerPage,
  page,
  onSearchTermChange,
  onStatusFilterChange,
  onRowsPerPageChange,
  onPageChange,
  onViewProduct,
  onEditProduct,
  onAddProduct,
  onShowCleanerInventory,
  onShowLowStock,
  onClearFilters,
  updateURLParams,
  archived = false,
}: InventoryViewProps) {
  const router = useRouter();
  const getProductStatusBadge = (product: Product) => {
    // Cleaner pickups are no longer blocked by low/zero stock, so a locker count
    // can legitimately go negative. Surface that as its own state so the admin
    // knows to reconcile it rather than reading it as ordinary low stock
    // (fix list item 5).
    if (product.stockLevel < 0) {
      return (
        <Link href={`/admin/inventory/${product.id}`}>
          <Badge variant="error" size="sm" className="px-2 py-1 cursor-pointer">
            Reconcile ({product.stockLevel})
          </Badge>
        </Link>
      );
    }
    if (product.isLowStock) {
      // Item 14: say WHICH action this alert is asking for. "Low Stock" alone
      // didn't distinguish "Cleano must buy more" from "a cleaner needs a
      // top-up" — this badge is driven by the COMPANY reorder threshold.
      return (
        <Link href={`/admin/inventory/${product.id}`}>
          <Badge
            variant="error"
            size="sm"
            className="px-2 py-1 cursor-pointer"
            title={`${LOW_STOCK_LABEL.COMPANY_PURCHASE} — at or below the company reorder threshold of ${product.minStock} ${product.unit}`}>
            Purchase needed
          </Badge>
        </Link>
      );
    }
    return (
      <Badge variant="success" size="sm" className="px-2 py-1">
        In Stock
      </Badge>
    );
  };

  // Apply the low-stock filter (used by the stat card). Falls back to updating
  // the local filter when the parent doesn't provide a handler.
  const applyLowStock = () => {
    if (onShowLowStock) onShowLowStock();
    else onStatusFilterChange("low-stock");
    onPageChange(1);
    updateURLParams({ status: "low-stock", page: 1 });
  };

  const applyClearFilters = () => {
    if (onClearFilters) onClearFilters();
    else {
      onSearchTermChange("");
      onStatusFilterChange("all");
    }
    onPageChange(1);
    updateURLParams({ status: "all", search: "", page: 1 });
  };

  // Enhanced filtering logic for products
  const filteredProducts = products.filter((product) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      product.name.toLowerCase().includes(searchLower) ||
      (product.description &&
        product.description.toLowerCase().includes(searchLower)) ||
      product.unit.toLowerCase().includes(searchLower) ||
      product.id.toLowerCase().includes(searchLower);

    // Status filter
    const matchesStatus = (() => {
      if (statusFilter === "all") return true;
      if (statusFilter === "low-stock") return product.isLowStock;
      if (statusFilter === "in-stock") return !product.isLowStock;
      return true;
    })();

    return matchesSearch && matchesStatus;
  });

  // Pagination logic (counts the filtered list)
  const totalFilteredProducts = filteredProducts.length;
  const totalPages = Math.ceil(totalFilteredProducts / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

  // ── Multi-select + bulk actions ──────────────────────────────────────────
  const visibleIds = useMemo(
    () => paginatedProducts.map((p) => p.id),
    [paginatedProducts]
  );
  const sel = useRowSelection(visibleIds);
  const [showCategory, setShowCategory] = useState(false);
  const [showItemType, setShowItemType] = useState(false);
  const [showMinStock, setShowMinStock] = useState(false);
  const [minStockValue, setMinStockValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const closePanels = () => {
    setShowCategory(false);
    setShowItemType(false);
    setShowMinStock(false);
  };

  async function runSetCategory(category: ProductCategory) {
    if (sel.count === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkSetProductCategory(sel.selectedIds, category);
      if (!res.success) {
        alert(res.error);
        return;
      }
      closePanels();
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Fix a whole column of misclassifications in one pass — the escape hatch for
  // whatever the backfill's name heuristic got wrong (PDF #1).
  async function runSetItemType(itemType: ItemType) {
    if (sel.count === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkSetProductItemType(sel.selectedIds, itemType);
      if (!res.success) {
        alert(res.error);
        return;
      }
      closePanels();
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function runSetMinStock() {
    if (sel.count === 0) return;
    const value = Number(minStockValue);
    if (!Number.isFinite(value) || value < 0) {
      alert("Enter a valid min-stock value");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await bulkSetProductMinStock(sel.selectedIds, value);
      if (!res.success) {
        alert(res.error);
        return;
      }
      closePanels();
      setMinStockValue("");
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // How much of the current selection is still out in the field. Read off the
  // rows already rendered, so it costs nothing and can never disagree with the
  // "Assigned" column the admin is looking at.
  const archiveWarning = (() => {
    const selectedIds = new Set(sel.selectedIds);
    const held = products.filter(
      (p) => selectedIds.has(p.id) && p.employeeCount > 0
    );
    if (held.length === 0) return "";
    const units = held.reduce((s, p) => s + p.totalAssigned, 0);
    const names = held
      .slice(0, 3)
      .map((p) => p.name)
      .join(", ");
    const more = held.length > 3 ? `, +${held.length - 3} more` : "";
    return `\n\n${held.length} of them ${
      held.length === 1 ? "is" : "are"
    } still in cleaner kits (${names}${more} — ${units} units). Those kit items stay where they are; they can still be counted and removed, but the product can no longer be assigned to anyone new.`;
  })();

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => {
            await bulkRestore("product", sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
      ]
    : [
        {
          key: "itemType",
          label: "Set item type",
          icon: <Layers size={14} />,
          onRun: () => {
            setShowCategory(false);
            setShowMinStock(false);
            setShowItemType(true);
          },
        },
        {
          key: "category",
          label: "Set category",
          icon: <Tag size={14} />,
          onRun: () => {
            setShowItemType(false);
            setShowMinStock(false);
            setShowCategory(true);
          },
        },
        {
          key: "minStock",
          label: "Set min-stock",
          icon: <Gauge size={14} />,
          onRun: () => {
            setShowCategory(false);
            setShowItemType(false);
            setShowMinStock(true);
          },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          // Archiving a product a cleaner still holds is legitimate (you
          // archive it precisely because it is being phased out) but it must
          // not be SILENT — an archived product stays in every kit that has
          // one, and the p.6 "Product not found." bug was the downstream cost
          // of nobody being told (Stage 5). The counts are already on screen,
          // so this is honesty for free.
          confirm: `Delete ${sel.count} selected product${
            sel.count === 1 ? "" : "s"
          }?${archiveWarning}\n\nThey can be restored from Archived.`,
          onRun: async () => {
            await bulkSoftDelete("product", sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
      ];

  // Helper functions for pagination
  const goToPage = (newPage: number) => {
    onPageChange(newPage);
    updateURLParams({ page: newPage });
  };

  const changeRowsPerPage = (newRowsPerPage: number) => {
    onRowsPerPageChange(newRowsPerPage);
    onPageChange(1);
    updateURLParams({ rowsPerPage: newRowsPerPage, page: 1 });
  };

  // Inventory stats — derived from product list (matches Jobs page pattern).
  const totalProducts = products.length;
  const lowStockCount = products.filter((p) => p.isLowStock).length;
  // Locker counts that went negative from unblocked pickups — these need an
  // admin stock count, not a purchase order (fix list item 5).
  const negativeStockCount = products.filter((p) => p.stockLevel < 0).length;
  const totalValue = products.reduce((s, p) => s + p.totalInventory * p.costPerUnit, 0);
  const assignedCount = products.reduce((s, p) => s + p.totalAssigned, 0);

  return (
    <div>
      {/* Header — matches /jobs */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 32,
          gap: 16,
          flexWrap: "wrap",
        }}>
        <div>
          <p className="admin-eyebrow">Operations</p>
          <h1 className="admin-page-title">
            Inventory{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>
              · {totalProducts}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              router.push(archived ? "/admin/inventory" : "/admin/inventory?archived=1")
            }
            className="btn btn-secondary btn-sm"
            style={
              archived
                ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
                : undefined
            }>
            {archived ? "Active products" : "Archived"}
          </button>
          {!archived && (
            <>
              <ImportCsvButton entity="products" label="Import Products" triggerClassName="btn btn-secondary btn-sm" />
              <ImportCsvButton entity="inventory-requests" label="Import Requests" triggerClassName="btn btn-secondary btn-sm" />
              <Button
                variant="primary"
                border={false}
                onClick={onAddProduct}
                className="rounded-xl px-5 py-2.5">
                <Plus className="w-4 h-4 mr-2" /> New product
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Stats — matches Jobs page. Cards are actionable: they filter the list
          or jump to the related view. */}
      <div className="astat-grid" style={{ marginBottom: 28 }}>
        <button
          type="button"
          onClick={applyClearFilters}
          className="astat"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          title="Show all products (clear filters)">
          <div className="astat-head">
            <span className="astat-label">Total products</span>
            <div className="astat-icon"><Boxes size={15} /></div>
          </div>
          <div className="astat-value">{totalProducts}</div>
          <div className="astat-delta">View all</div>
        </button>
        <button
          type="button"
          onClick={applyLowStock}
          className="astat"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          title="Filter to low-stock products">
          <div className="astat-head">
            <span className="astat-label">Needs purchasing</span>
            <div className="astat-icon"><AlertTriangle size={15} /></div>
          </div>
          <div className="astat-value">{lowStockCount}</div>
          <div className="astat-delta">
            {negativeStockCount > 0
              ? `${negativeStockCount} negative — reconcile`
              : lowStockCount > 0
              ? `${lowStockCount} to re-order`
              : "Filter list"}
          </div>
        </button>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Stock value</span>
            <div className="astat-icon"><DollarSign size={15} /></div>
          </div>
          <div className="astat-value">${totalValue.toFixed(2)}</div>
        </div>
        <button
          type="button"
          onClick={() => onShowCleanerInventory?.()}
          className="astat"
          style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}
          title="View cleaner-assigned stock">
          <div className="astat-head">
            <span className="astat-label">Assigned to crew</span>
            <div className="astat-icon"><Users size={15} /></div>
          </div>
          <div className="astat-value">{assignedCount.toFixed(0)}</div>
          <div className="astat-delta">View cleaner inventory</div>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col lg:flex-row gap-2 mb-6">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#008C9C] z-10 w-4 h-4" />
            <Input
              placeholder="Search by product name, description, or ID..."
              value={searchTerm}
              size="md"
              onChange={(e) => {
                onSearchTermChange(e.target.value);
                onPageChange(1);
                updateURLParams({ search: e.target.value, page: 1 });
              }}
              className="pl-10 h-[42px] py-3 placeholder:!text-[#008C9C]/40 placeholder:!font-[350]"
              variant="form"
              border={false}
            />
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-2">
          {/* Status Filter */}
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="md"
                border={false}
                type="button"
                className="min-w-36 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                <span className="text-left w-full text-sm font-[350]">
                  {[
                    { value: "all", label: "All Products" },
                    { value: "in-stock", label: "In Stock" },
                    { value: "low-stock", label: "Low Stock" },
                  ].find((opt) => opt.value === statusFilter)?.label ||
                    "All Products"}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "All Products",
                onClick: () => {
                  onStatusFilterChange("all");
                  onPageChange(1);
                  updateURLParams({ status: "all", page: 1 });
                },
              },
              {
                label: "In Stock",
                onClick: () => {
                  onStatusFilterChange("in-stock");
                  onPageChange(1);
                  updateURLParams({ status: "in-stock", page: 1 });
                },
              },
              {
                label: "Low Stock",
                onClick: () => {
                  onStatusFilterChange("low-stock");
                  onPageChange(1);
                  updateURLParams({ status: "low-stock", page: 1 });
                },
              },
            ]}
            maxHeight="12rem"
          />

          {/* Rows Per Page */}
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="md"
                border={false}
                className="min-w-24 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                <span className="text-sm font-[350]">{rowsPerPage} / page</span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "5",
                onClick: () => changeRowsPerPage(5),
              },
              {
                label: "10",
                onClick: () => changeRowsPerPage(10),
              },
              {
                label: "25",
                onClick: () => changeRowsPerPage(25),
              },
              {
                label: "50",
                onClick: () => changeRowsPerPage(50),
              },
              {
                label: "100",
                onClick: () => changeRowsPerPage(100),
              },
            ]}
            className="min-w-20"
            maxHeight="12rem"
          />
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="bg-white rounded-2xl">
          <div className="text-center py-12">
            <Loader className="w-4 h-4 animate-spin text-[#008C9C] mx-auto mb-2" />
            <span className="app-subtitle">Loading products...</span>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {totalFilteredProducts === 0 ? (
            <div className="bg-white rounded-2xl">
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Package className="w-8 h-8 text-[#008C9C]/40" />
                </div>
                <p className="text-sm font-[350] text-[#008C9C]/70">
                  No products found
                </p>
                <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
                  Products in your inventory will appear here
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl">
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto rounded-t-2xl">
                <div className="min-w-max">
                  {/* Header */}
                  <div className="flex bg-[#008C9C]/5 rounded-t-2xl">
                    <div className="w-[48px] p-4 flex items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={sel.allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = sel.someSelected;
                        }}
                        onChange={sel.toggleAll}
                        style={{ cursor: "pointer" }}
                      />
                    </div>
                    {[
                      { label: "Product Name", className: "w-[220px]" },
                      { label: "Description", className: "w-[260px]" },
                      { label: "Stock Level", className: "w-[150px]" },
                      { label: "Min Stock", className: "w-[150px]" },
                      { label: "Assigned", className: "w-[150px]" },
                      { label: "Employees", className: "w-[150px]" },
                      { label: "Status", className: "w-[150px]" },
                      { label: "Actions", className: "w-[210px]" },
                    ].map((col) => (
                      <div
                        key={col.label}
                        className={`${col.className} p-4 text-left text-xs font-[350] !text-[#008C9C]/40 uppercase tracking-wide`}>
                        {col.label}
                      </div>
                    ))}
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-[#008C9C]/4">
                    {paginatedProducts.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center hover:bg-[#008C9C]/1 transition-colors">
                        {/* Select */}
                        <div
                          className="w-[48px] p-4 flex items-center justify-center"
                          onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={sel.isSelected(product.id)}
                            onChange={() => sel.toggle(product.id)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ cursor: "pointer" }}
                          />
                        </div>
                        {/* Product Name */}
                        <div className="w-[220px] p-4">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-[350] text-[#008C9C] truncate">
                              {product.name}
                            </p>
                            <BuyLink product={product} />
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            <ItemTypeChip itemType={product.itemType} />
                            <p className="text-xs text-[#008C9C]/50 font-[350] truncate">
                              ${product.costPerUnit.toFixed(2)} / {product.unit}
                            </p>
                          </div>
                        </div>

                        {/* Description */}
                        <div className="w-[260px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]/100 truncate">
                            {product.description || "-"}
                          </p>
                        </div>

                        {/* Stock Level */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]/100 truncate">
                            {product.stockLevel} {product.unit}
                          </p>
                          {product.stockUpdatedAt && (
                            <p className="text-xs text-[#008C9C]/50 font-[350] truncate mt-0.5">
                              Updated {fmtDateTime(product.stockUpdatedAt)}
                              {product.stockUpdatedByName
                                ? ` by ${product.stockUpdatedByName}`
                                : ""}
                            </p>
                          )}
                        </div>

                        {/* Min Stock */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]/100 truncate">
                            {product.minStock} {product.unit}
                          </p>
                        </div>

                        {/* Assigned */}
                        <div className="w-[150px] p-4">
                          {product.totalAssigned > 0 ? (
                            <Badge variant="cleano" size="sm">
                              {product.totalAssigned} {product.unit}
                            </Badge>
                          ) : (
                            <p className="text-sm font-[350] text-[#008C9C]/100">
                              0
                            </p>
                          )}
                        </div>

                        {/* Employees */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]/100 truncate">
                            {product.employeeCount > 0
                              ? product.employeeCount
                              : "-"}
                          </p>
                        </div>

                        {/* Status */}
                        <div className="w-[150px] p-4">
                          {getProductStatusBadge(product)}
                        </div>

                        {/* Actions */}
                        <div className="w-[210px] p-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              border={false}
                              onClick={() => onEditProduct(product)}
                              className="rounded-2xl px-4 py-3 whitespace-nowrap">
                              Edit
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              border={false}
                              onClick={() => onViewProduct(product)}
                              className="rounded-2xl px-4 py-3 whitespace-nowrap">
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 p-4">
                {paginatedProducts.map((product) => (
                  <Card
                    key={product.id}
                    variant="cleano_light"
                    className="p-4 cursor-pointer"
                    onClick={() => onViewProduct(product)}>
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={sel.isSelected(product.id)}
                          onChange={() => sel.toggle(product.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: "pointer", marginTop: 2 }}
                        />
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-[400] text-[#008C9C]">
                              {product.name}
                            </p>
                            <BuyLink product={product} />
                            <ItemTypeChip itemType={product.itemType} />
                          </div>
                          <p className="text-xs text-[#008C9C]/70 mt-1">
                            {product.description || "No description"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[#008C9C]/50">
                            Stock Level
                          </p>
                          <p className="text-sm font-[350] text-[#008C9C]">
                            {product.stockLevel} {product.unit}
                          </p>
                          {product.stockUpdatedAt && (
                            <p className="text-xs text-[#008C9C]/50 font-[350] mt-0.5">
                              Updated {fmtDateTime(product.stockUpdatedAt)}
                              {product.stockUpdatedByName
                                ? ` by ${product.stockUpdatedByName}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div>{getProductStatusBadge(product)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          border={false}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditProduct(product);
                          }}
                          className="rounded-2xl px-4 py-2">
                          <Pencil className="w-3 h-3 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          border={false}
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewProduct(product);
                          }}
                          className="rounded-2xl px-4 py-2">
                          <Eye className="w-3 h-3 mr-2" />
                          View
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              {totalFilteredProducts > 0 && (
                <div className="flex items-center justify-between p-2 px-3 bg-[#008C9C]/4 rounded-b-2xl">
                  <div className="text-xs text-[#008C9C]/70 font-[350]">
                    Showing {startIndex + 1} to{" "}
                    {Math.min(endIndex, totalFilteredProducts)} of {totalFilteredProducts}{" "}
                    products
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(1)}
                      disabled={page === 1}
                      className="px-2">
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(page - 1)}
                      disabled={page === 1}
                      className="px-2">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <div className="flex items-center gap-1">
                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (page <= 3) {
                            pageNum = i + 1;
                          } else if (page >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = page - 2 + i;
                          }

                          return (
                            <Button
                              key={pageNum}
                              variant={page === pageNum ? "cleano" : "default"}
                              border={false}
                              size="md"
                              onClick={() => goToPage(pageNum)}
                              className="px-3 min-w-8 rounded-xl">
                              <span className="text-sm font-[350] text-[#008C9C]">
                                {pageNum}
                              </span>
                            </Button>
                          );
                        }
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(page + 1)}
                      disabled={page === totalPages}
                      className="px-2">
                      <ChevronRight className="w-4 h-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(totalPages)}
                      disabled={page === totalPages}
                      className="px-2">
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk-action pickers (shown above the floating bar) */}
      {sel.count > 0 && (showCategory || showItemType || showMinStock) && (
        <div
          style={{
            position: "sticky",
            bottom: 76,
            zIndex: 41,
            display: "flex",
            justifyContent: "center",
            marginTop: 12,
          }}>
          {showItemType && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
                maxWidth: "calc(100vw - 32px)",
                background: "#fff",
                border: "1px solid var(--primary-10)",
                borderRadius: 12,
                padding: "10px 14px",
                boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
              }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Set item type to
              </span>
              {ITEM_TYPES.map((t) => (
                <Button
                  key={t}
                  variant="secondary"
                  size="sm"
                  onClick={() => runSetItemType(t)}
                  disabled={bulkBusy}
                  className="rounded-lg px-3">
                  {ITEM_TYPE_NAME[t]}
                </Button>
              ))}
              <button
                type="button"
                onClick={() => setShowItemType(false)}
                style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13, color: "var(--primary-60)" }}>
                Cancel
              </button>
            </div>
          )}
          {showCategory && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
                maxWidth: "calc(100vw - 32px)",
                background: "#fff",
                border: "1px solid var(--primary-10)",
                borderRadius: 12,
                padding: "10px 14px",
                boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
              }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Set category to
              </span>
              {CATEGORY_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  variant="secondary"
                  size="sm"
                  onClick={() => runSetCategory(opt.value)}
                  disabled={bulkBusy}
                  className="rounded-lg px-3">
                  {opt.label}
                </Button>
              ))}
              <button
                type="button"
                onClick={() => setShowCategory(false)}
                style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13, color: "var(--primary-60)" }}>
                Cancel
              </button>
            </div>
          )}
          {showMinStock && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 10,
                maxWidth: "calc(100vw - 32px)",
                background: "#fff",
                border: "1px solid var(--primary-10)",
                borderRadius: 12,
                padding: "10px 14px",
                boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
              }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Set min-stock to
              </span>
              <input
                type="number"
                min={0}
                value={minStockValue}
                onChange={(e) => setMinStockValue(e.target.value)}
                style={{
                  width: 90,
                  padding: "6px 10px",
                  border: "1px solid var(--primary-20, #cbd5e1)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              <Button
                variant="primary"
                border={false}
                size="sm"
                onClick={runSetMinStock}
                disabled={minStockValue === "" || bulkBusy}
                className="rounded-lg px-4">
                {bulkBusy ? "Saving…" : `Apply to ${sel.count}`}
              </Button>
              <button
                type="button"
                onClick={() => { setShowMinStock(false); setMinStockValue(""); }}
                style={{ background: "none", border: 0, cursor: "pointer", fontSize: 13, color: "var(--primary-60)" }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <BulkActionBar
        count={sel.count}
        actions={bulkActions}
        onClear={() => { sel.clear(); closePanels(); }}
        noun="product"
        total={visibleIds.length}
        allSelected={sel.allSelected}
        onToggleAll={sel.toggleAll}
      />
    </div>
  );
}
