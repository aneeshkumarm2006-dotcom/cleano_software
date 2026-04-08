"use client";

import React from "react";
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
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import CustomDropdown from "@/components/ui/custom-dropdown";

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
  // URL update function
  updateURLParams: (updates: Record<string, string | number>) => void;
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
  updateURLParams,
}: InventoryViewProps) {
  const getProductStatusBadge = (product: Product) => {
    if (product.isLowStock) {
      return (
        <Badge variant="error" size="sm" className="px-2 py-1">
          Low Stock
        </Badge>
      );
    }
    return (
      <Badge variant="success" size="sm" className="px-2 py-1">
        In Stock
      </Badge>
    );
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

  // Pagination logic
  const totalProducts = filteredProducts.length;
  const totalPages = Math.ceil(totalProducts / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

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

  return (
    <div className="">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex flex-col">
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            Inventory
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Manage your inventory and track your stock levels
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={onAddProduct}
          className="rounded-2xl px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col lg:flex-row gap-2 mb-6">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#005F6A] z-[100] w-4 h-4" />
            <Input
              placeholder="Search by product name, description, or ID..."
              value={searchTerm}
              size="md"
              onChange={(e) => {
                onSearchTermChange(e.target.value);
                onPageChange(1);
                updateURLParams({ search: e.target.value, page: 1 });
              }}
              className="pl-10 h-[42px] py-3 placeholder:!text-[#005F6A]/40 placeholder:!font-[350]"
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
            <Loader className="w-4 h-4 animate-spin text-[#005F6A] mx-auto mb-2" />
            <span className="app-subtitle">Loading products...</span>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {totalProducts === 0 ? (
            <div className="bg-white rounded-2xl">
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Package className="w-8 h-8 text-[#005F6A]/40" />
                </div>
                <p className="text-sm font-[350] text-[#005F6A]/70">
                  No products found
                </p>
                <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
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
                  <div className="flex bg-[#005F6A]/5 rounded-t-2xl">
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
                        className={`${col.className} p-4 text-left text-xs font-[350] !text-[#005F6A]/40 uppercase tracking-wide`}>
                        {col.label}
                      </div>
                    ))}
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-[#005F6A]/4">
                    {paginatedProducts.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                        {/* Product Name */}
                        <div className="w-[220px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A] truncate">
                            {product.name}
                          </p>
                          <p className="text-xs text-[#005F6A]/50 font-[350] truncate mt-0.5">
                            ${product.costPerUnit.toFixed(2)} / {product.unit}
                          </p>
                        </div>

                        {/* Description */}
                        <div className="w-[260px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/100 truncate">
                            {product.description || "-"}
                          </p>
                        </div>

                        {/* Stock Level */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/100 truncate">
                            {product.stockLevel} {product.unit}
                          </p>
                        </div>

                        {/* Min Stock */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/100 truncate">
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
                            <p className="text-sm font-[350] text-[#005F6A]/100">
                              0
                            </p>
                          )}
                        </div>

                        {/* Employees */}
                        <div className="w-[150px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/100 truncate">
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
                      <div>
                        <p className="text-sm font-[400] text-[#005F6A]">
                          {product.name}
                        </p>
                        <p className="text-xs text-[#005F6A]/70 mt-1">
                          {product.description || "No description"}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-[#005F6A]/50">
                            Stock Level
                          </p>
                          <p className="text-sm font-[350] text-[#005F6A]">
                            {product.stockLevel} {product.unit}
                          </p>
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
              {totalProducts > 0 && (
                <div className="flex items-center justify-between p-2 px-3 bg-[#005F6A]/4 rounded-b-2xl">
                  <div className="text-xs text-[#005F6A]/70 font-[350]">
                    Showing {startIndex + 1} to{" "}
                    {Math.min(endIndex, totalProducts)} of {totalProducts}{" "}
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
                              <span className="text-sm font-[350] text-[#005F6A]">
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
    </div>
  );
}
