"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InventoryView from "./InventoryView";
import { ProductModal } from "./ProductModal";
import SupplierComparison from "./SupplierComparison";
import ForecastView from "./ForecastView";
import Button from "@/components/ui/Button";
import { Package, DollarSign, TrendingDown } from "lucide-react";

interface Product {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
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
    suppliers: Array<{ id: string; name: string }>;
  };
  forecastData?: ForecastEmployee[];
}

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "products", label: "Products", icon: <Package className="w-4 h-4" /> },
  { id: "suppliers", label: "Supplier Comparison", icon: <DollarSign className="w-4 h-4" /> },
  { id: "forecast", label: "Forecast", icon: <TrendingDown className="w-4 h-4" /> },
];

export default function InventoryPageClient({
  initialProducts,
  initialSearch,
  initialStatus,
  initialPage,
  initialRowsPerPage,
  supplierData,
  forecastData,
}: InventoryPageClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
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

    router.push(`/inventory?${params.toString()}`);
  };

  const handleViewProduct = (product: Product) => {
    router.push(`/inventory/${product.id}`);
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
    <>
      {/* Tabs */}
      <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 w-fit overflow-x-auto mb-6">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              border={false}
              onClick={() => setActiveTab(tab.id)}
              variant={isActive ? "action" : "ghost"}
              size="md"
              className="rounded-xl px-4 md:px-6 py-3 whitespace-nowrap">
              <span className="mr-2 hidden sm:inline">{tab.icon}</span>
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "products" && (
        <>
          <InventoryView
            products={initialProducts}
            isLoading={isLoading}
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
    </>
  );
}
