"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InventoryView from "./InventoryView";
import { ProductModal } from "./ProductModal";
import SupplierComparison from "./SupplierComparison";
import ForecastView from "./ForecastView";
import { Package, DollarSign, TrendingDown } from "lucide-react";

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
    usagePerJob: number;
    refillThreshold: number;
    projectedUsage: number;
    deficit: number;
    needsRefill: boolean;
  }>;
}

type TabId = "products" | "suppliers" | "forecast";

interface InventoryPageClientProps {
  initialProducts: Product[];
  initialSearch: string;
  initialStatus: string;
  initialPage: number;
  initialRowsPerPage: number;
  supplierData?: {
    products: ProductWithPrices[];
    suppliers: Array<{ id: string; name: string; website?: string | null }>;
  };
  forecastData?: ForecastEmployee[];
  archived?: boolean;
}

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "products", label: "Products", icon: <Package size={15} /> },
  { id: "suppliers", label: "Supplier Comparison", icon: <DollarSign size={15} /> },
  { id: "forecast", label: "Forecast", icon: <TrendingDown size={15} /> },
];

export default function InventoryPageClient({
  initialProducts,
  initialSearch,
  initialStatus,
  initialPage,
  initialRowsPerPage,
  supplierData,
  forecastData,
  archived = false,
}: InventoryPageClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("products");

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

      {activeTab === "suppliers" && supplierData && (
        <SupplierComparison
          products={supplierData.products}
          suppliers={supplierData.suppliers}
        />
      )}

      {activeTab === "forecast" && forecastData && (
        <ForecastView employees={forecastData} />
      )}
    </div>
  );
}
