"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InventoryView from "./InventoryView";
import { ProductModal } from "./ProductModal";
import SupplierComparison from "./SupplierComparison";
import ForecastView from "./ForecastView";
import CleanerInventoryView from "./CleanerInventoryView";
import RequestsView from "./RequestsView";
import QuickAssignModal, {
  type QuickAssignCleaner,
  type QuickAssignProduct,
} from "./QuickAssignModal";
import ActivityView from "./ActivityView";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import {
  Package,
  DollarSign,
  TrendingDown,
  Users,
  ClipboardList,
  Settings,
  ArrowUpRight,
  Activity,
} from "lucide-react";

type ProductCategory = "LIQUID_SPRAY" | "MOP_LIQUID" | "DISPOSABLE" | "OTHER";

interface Product {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
  category?: ProductCategory;
  stockUpdatedAt: string | null;
  stockUpdatedByName: string | null;
  purchaseUrl: string | null;
  links: Array<{ label: string; url: string }>;
  totalAssigned: number;
  employeeCount: number;
  totalInventory: number;
  isLowStock: boolean;
}

interface SupplierPriceEntry {
  supplierId: string;
  supplierName: string;
  price: number;
  unit: string | null;
  notes: string | null;
}

interface ProductWithPrices {
  productId: string;
  productName: string;
  unit: string;
  costPerUnit: number;
  supplierPrices: SupplierPriceEntry[];
}

interface ForecastEmployee {
  employeeId: string;
  employeeName: string;
  upcomingJobCount: number;
  items: Array<{
    productId: string;
    productName: string;
    unit: string;
    currentQuantity: number;
    averagePerJob: number;
    refillThreshold: number;
    projectedUsage: number;
    deficit: number;
    needsRefill: boolean;
  }>;
}

type TabId =
  | "products"
  | "cleaners"
  | "activity"
  | "requests"
  | "suppliers"
  | "forecast"
  | "settings";

interface CleanerInventoryEntry {
  employeeId: string;
  employeeName: string;
  role: string;
  itemCount: number;
  totalUnits: number;
  totalValue: number;
  lowCount: number;
  items: Array<{
    productId: string;
    productName: string;
    unit: string;
    quantity: number;
    costPerUnit: number;
    refillThreshold: number;
    isLow: boolean;
    lastChange: {
      at: string;
      by: string | null;
      delta: number;
      reason: string | null;
    } | null;
  }>;
}

interface RequestEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  productId: string | null;
  itemName: string;
  isKit: boolean;
  unit: string | null;
  warehouseStock: number | null;
  quantity: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED";
  createdAt: string;
}

interface InventoryPageClientProps {
  initialProducts: Product[];
  initialSearch: string;
  initialStatus: string;
  initialView?: string;
  initialPage: number;
  initialRowsPerPage: number;
  supplierData?: {
    products: ProductWithPrices[];
    suppliers: Array<{ id: string; name: string; website?: string | null }>;
  };
  forecastData?: ForecastEmployee[];
  cleanerInventory?: CleanerInventoryEntry[];
  /** OWNER/ADMIN may edit cleaner kit counts; everyone else gets read-only. */
  canEditCleanerInventory?: boolean;
  /** Quick-assign source data (items 6 + 13) — ALL products / ALL cleaners. */
  assignProducts?: QuickAssignProduct[];
  assignCleaners?: QuickAssignCleaner[];
  assignLocations?: { id: string; name: string }[];
  requests?: RequestEntry[];
  archived?: boolean;
}

function isTabId(v: string): v is TabId {
  return (
    v === "products" ||
    v === "cleaners" ||
    v === "activity" ||
    v === "requests" ||
    v === "suppliers" ||
    v === "forecast" ||
    v === "settings"
  );
}

export default function InventoryPageClient({
  initialProducts,
  initialSearch,
  initialStatus,
  initialView = "products",
  initialPage,
  initialRowsPerPage,
  supplierData,
  forecastData,
  cleanerInventory = [],
  canEditCleanerInventory = false,
  assignProducts = [],
  assignCleaners = [],
  assignLocations = [],
  requests = [],
  archived = false,
}: InventoryPageClientProps) {
  const router = useRouter();

  // Quick assign (items 6 + 13). `assignFor` pre-selects a cleaner when opened
  // from a specific row via "Assign more" (item 17).
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const openAssign = (cleanerId?: string) => {
    setAssignFor(cleanerId ?? null);
    setAssignOpen(true);
  };

  const pendingRequests = requests.filter((r) => r.status === "PENDING").length;
  const lowCleanerCount = cleanerInventory.filter((c) => c.lowCount > 0).length;

  const TABS: Array<{
    id: TabId;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    { id: "products", label: "Products", icon: <Package size={15} /> },
    {
      id: "cleaners",
      label: "Cleaner Inventory",
      icon: <Users size={15} />,
      badge: lowCleanerCount,
    },
    { id: "activity", label: "Activity", icon: <Activity size={15} /> },
    {
      id: "requests",
      label: "Requests",
      icon: <ClipboardList size={15} />,
      badge: pendingRequests,
    },
    { id: "suppliers", label: "Supplier Comparison", icon: <DollarSign size={15} /> },
    { id: "forecast", label: "Forecast", icon: <TrendingDown size={15} /> },
    { id: "settings", label: "Settings", icon: <Settings size={15} /> },
  ];

  const [activeTab, setActiveTab] = useState<TabId>(
    isTabId(initialView) ? initialView : "products"
  );

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");

  // Filter state
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);

  const updateURLParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams();

    const finalSearch =
      updates.search !== undefined ? String(updates.search) : searchTerm;
    const finalStatus =
      updates.status !== undefined ? String(updates.status) : statusFilter;
    const finalPage = updates.page !== undefined ? Number(updates.page) : page;
    const finalRowsPerPage =
      updates.rowsPerPage !== undefined
        ? Number(updates.rowsPerPage)
        : rowsPerPage;

    if (finalSearch) params.set("search", finalSearch);
    if (finalStatus && finalStatus !== "all") params.set("status", finalStatus);
    if (finalPage > 1) params.set("page", String(finalPage));
    if (finalRowsPerPage !== 10)
      params.set("rowsPerPage", String(finalRowsPerPage));

    router.push(`/admin/inventory?${params.toString()}`);
  };

  const handleViewProduct = (product: Product) => {
    router.push(`/admin/inventory/${product.id}`);
  };

  const handleEditProduct = (product: Product) => {
    setSelectedProduct(product);
    setModalMode("edit");
    setModalOpen(true);
  };

  const handleAddProduct = () => {
    setSelectedProduct(null);
    setModalMode("create");
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedProduct(null);
  };

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Operations</p>
        <h1 className="display">Inventory</h1>
      </header>

      <div className="atabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`atab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {tab.icon}
              {tab.label}
              {tab.badge ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 9,
                    background: "var(--error, #dc2626)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                  {tab.badge}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "products" && (
        <>
          <InventoryView
            products={initialProducts}
            isLoading={false}
            searchTerm={searchTerm}
            statusFilter={statusFilter}
            rowsPerPage={rowsPerPage}
            page={page}
            onSearchTermChange={setSearchTerm}
            onStatusFilterChange={setStatusFilter}
            onRowsPerPageChange={setRowsPerPage}
            onPageChange={setPage}
            onViewProduct={handleViewProduct}
            onEditProduct={handleEditProduct}
            onAddProduct={handleAddProduct}
            onShowCleanerInventory={() => setActiveTab("cleaners")}
            onShowLowStock={() => {
              setStatusFilter("low-stock");
              setPage(1);
            }}
            onClearFilters={() => {
              setSearchTerm("");
              setStatusFilter("all");
              setPage(1);
            }}
            updateURLParams={updateURLParams}
            archived={archived}
          />

          <ProductModal
            isOpen={modalOpen}
            onClose={handleCloseModal}
            product={selectedProduct}
            mode={modalMode}
          />
        </>
      )}

      {activeTab === "cleaners" && (
        <CleanerInventoryView
          cleaners={cleanerInventory}
          canEdit={canEditCleanerInventory}
          onAssign={canEditCleanerInventory ? openAssign : undefined}
        />
      )}

      {canEditCleanerInventory && (
        <QuickAssignModal
          key={assignFor ?? "any"}
          isOpen={assignOpen}
          onClose={() => setAssignOpen(false)}
          products={assignProducts}
          cleaners={assignCleaners}
          locations={assignLocations}
          initialCleanerId={assignFor}
        />
      )}

      {activeTab === "activity" && (
        <ActivityView
          cleaners={assignCleaners.map((c) => ({ id: c.id, name: c.name }))}
          products={assignProducts.map((p) => ({ id: p.id, name: p.name }))}
        />
      )}

      {activeTab === "requests" && <RequestsView requests={requests} />}

      {activeTab === "suppliers" && supplierData && (
        <SupplierComparison
          products={supplierData.products}
          suppliers={supplierData.suppliers}
        />
      )}

      {activeTab === "forecast" && forecastData && (
        <ForecastView employees={forecastData} />
      )}

      {activeTab === "settings" && (
        <Card variant="default" className="p-8 max-w-2xl">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-[#008C9C]/10 rounded-lg">
              <Settings className="w-4 h-4 text-[#008C9C]" />
            </div>
            <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
              Inventory Settings
            </h2>
          </div>
          <p className="text-sm text-[#008C9C]/70 mb-6">
            Refill thresholds, per-job usage rules, units, suppliers and kit
            templates are configured in Settings. Changes there drive the low-stock
            alerts and forecasts shown across this hub.
          </p>
          <Link href="/admin/settings">
            <Button variant="primary" border={false} className="rounded-xl px-5 py-2.5">
              <Settings className="w-4 h-4 mr-2" />
              Open inventory settings
              <ArrowUpRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );
}
