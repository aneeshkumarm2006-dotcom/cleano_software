"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InventoryView from "./InventoryView";
import { ProductModal } from "./ProductModal";

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

interface InventoryPageClientProps {
  initialProducts: Product[];
  initialSearch: string;
  initialStatus: string;
  initialPage: number;
  initialRowsPerPage: number;
}

export default function InventoryPageClient({
  initialProducts,
  initialSearch,
  initialStatus,
  initialPage,
  initialRowsPerPage,
}: InventoryPageClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

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
  );
}
