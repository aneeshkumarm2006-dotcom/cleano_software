"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  X,
  Package,
  Loader,
  Trash2,
  DollarSign,
  Hash,
  FileText,
  AlertTriangle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import createProduct from "../actions/createProduct";
import { updateProduct } from "../actions/updateProduct";
import { deleteProduct } from "../actions/deleteProduct";

interface Product {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
  mode: "create" | "edit";
}

const formSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  description: z.string().optional(),
  unit: z.string().min(1, "Unit is required"),
  costPerUnit: z.coerce.number().min(0, "Cost must be 0 or greater"),
  stockLevel: z.coerce.number().min(0, "Stock level must be 0 or greater"),
  minStock: z.coerce.number().min(0, "Minimum stock must be 0 or greater"),
});

type FormValues = z.infer<typeof formSchema>;

export function ProductModal({
  isOpen,
  onClose,
  product,
  mode,
}: ProductModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: "",
      unit: "",
      costPerUnit: 0,
      stockLevel: 0,
      minStock: 0,
    },
  });

  // Reset form when product or mode changes
  useEffect(() => {
    if (isOpen) {
      reset({
        name: product?.name || "",
        description: product?.description || "",
        unit: product?.unit || "",
        costPerUnit: product?.costPerUnit || 0,
        stockLevel: product?.stockLevel || 0,
        minStock: product?.minStock || 0,
      });
    }
  }, [isOpen, product, mode, reset]);

  const disableForm = submitting || isDeleting;

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setGlobalError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("name", values.name);
      formData.append("description", values.description || "");
      formData.append("unit", values.unit);
      formData.append("costPerUnit", String(values.costPerUnit));
      formData.append("stockLevel", String(values.stockLevel));
      formData.append("minStock", String(values.minStock));

      let result;
      if (mode === "create") {
        result = await createProduct({ message: "", error: "" }, formData);
      } else {
        result = await updateProduct(
          product!.id,
          { message: "", error: "" },
          formData
        );
      }

      if (result.error) {
        throw new Error(result.error);
      }

      setSuccessMessage(
        result.message ||
          (mode === "create"
            ? "Product created successfully"
            : "Product updated successfully")
      );

      setTimeout(() => {
        reset();
        handleClose();
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("Submit error:", error);
      setGlobalError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;

    setIsDeleting(true);
    setGlobalError(null);

    try {
      const result = await deleteProduct(product.id);

      if (!result.success) {
        throw new Error(result.error || "Failed to delete product");
      }

      handleClose();
      window.location.reload();
    } catch (error) {
      setGlobalError(
        error instanceof Error ? error.message : "Failed to delete product"
      );
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleClose = () => {
    if (!submitting && !isDeleting) {
      reset();
      setGlobalError(null);
      setSuccessMessage(null);
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={handleClose}
      />

      {/* Modal Container */}
      <div className="relative z-[1001] w-full max-w-2xl max-h-[95vh] gap-0 bg-white rounded-3xl overflow-hidden">
        {/* Form Section */}
        <section className="w-full bg-[#ffffff]/5 flex items-start justify-center overflow-y-auto">
          <div className="w-full max-w-[80rem] mx-auto px-6 md:px-8 py-6 md:py-8">
            {/* Header */}
            <div className="w-full flex items-start justify-between gap-1 mb-8">
              <div>
                <h1 className="text-3xl font-[350] tracking-tight text-[#005F6A] max-w-[40rem]">
                  {mode === "create" ? "Add New Product" : "Edit Product"}
                </h1>
                <p className="text-sm text-[#005F6A]/80">
                  {mode === "create"
                    ? "Add a new product to your inventory"
                    : "Update product details"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={disableForm}
                className="!p-2">
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-green-50 border border-green-200 mb-6">
                <div className="flex flex-col gap-1 flex-1">
                  <p className="text-sm text-green-700 font-[400]">
                    {successMessage}
                  </p>
                </div>
              </div>
            )}

            {/* Delete Confirmation */}
            {mode === "edit" && showDeleteConfirm && (
              <div className="rounded-2xl p-4 flex items-start gap-3 bg-red-50 border border-red-200 mb-6">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2 flex-1">
                  <p className="text-sm text-red-700 font-[400]">
                    Are you sure you want to delete this product?
                  </p>
                  <p className="text-xs text-red-600/70">
                    This action cannot be undone. All inventory data for this
                    product will be permanently removed.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      border={false}
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="px-4 py-2">
                      {isDeleting ? (
                        <>
                          <Loader className="w-4 h-4 mr-2 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Confirm Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Product Name */}
              <div>
                <label className="input-label">
                  Product Name <span className="text-red-500 ml-1">*</span>
                </label>
                <div className="relative">
                  <Input
                    variant="form"
                    type="text"
                    size="md"
                    {...register("name")}
                    disabled={disableForm}
                    error={!!errors.name}
                    className="w-full px-4 py-3"
                    placeholder="e.g., All-Purpose Cleaner"
                    border={false}
                  />
                </div>
                {errors.name && (
                  <p className="my-1 text-xs text-red-600">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="input-label">Description</label>
                <div className="relative">
                  <Textarea
                    variant="form"
                    size="md"
                    {...register("description")}
                    disabled={disableForm}
                    className="w-full px-4 py-3 min-h-[100px]"
                    placeholder="Brief description of the product..."
                    rows={3}
                  />
                </div>
                <p className="text-xs text-[#005F6A]/60 mt-1">
                  Optional description for internal reference
                </p>
              </div>

              {/* Unit and Cost Per Unit */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">
                    Unit <span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                    <Input
                      variant="form"
                      type="text"
                      size="md"
                      {...register("unit")}
                      disabled={disableForm}
                      error={!!errors.unit}
                      className="w-full pl-11 px-4 py-3"
                      placeholder="e.g., bottles, liters, kg"
                      border={false}
                    />
                  </div>
                  {errors.unit && (
                    <p className="my-1 text-xs text-red-600">
                      {errors.unit.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="input-label">
                    Cost Per Unit <span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                    <Input
                      variant="form"
                      type="number"
                      size="md"
                      step="0.01"
                      min="0"
                      {...register("costPerUnit")}
                      disabled={disableForm}
                      error={!!errors.costPerUnit}
                      className="w-full pl-11 px-4 py-3"
                      placeholder="0.00"
                      border={false}
                    />
                  </div>
                  {errors.costPerUnit && (
                    <p className="my-1 text-xs text-red-600">
                      {errors.costPerUnit.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Stock Level and Min Stock */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="input-label">
                    Warehouse Stock <span className="text-red-500 ml-1">*</span>
                  </label>
                  <Input
                    variant="form"
                    type="number"
                    size="md"
                    step="0.01"
                    min="0"
                    {...register("stockLevel")}
                    disabled={disableForm}
                    error={!!errors.stockLevel}
                    className="w-full px-4 py-3"
                    placeholder="0"
                    border={false}
                  />
                  {errors.stockLevel && (
                    <p className="my-1 text-xs text-red-600">
                      {errors.stockLevel.message}
                    </p>
                  )}
                  <p className="text-xs text-[#005F6A]/60 mt-1">
                    Current quantity in warehouse
                  </p>
                </div>

                <div>
                  <label className="input-label">
                    Minimum Stock Level{" "}
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <Input
                    variant="form"
                    type="number"
                    size="md"
                    step="0.01"
                    min="0"
                    {...register("minStock")}
                    disabled={disableForm}
                    error={!!errors.minStock}
                    className="w-full px-4 py-3"
                    placeholder="0"
                    border={false}
                  />
                  {errors.minStock && (
                    <p className="my-1 text-xs text-red-600">
                      {errors.minStock.message}
                    </p>
                  )}
                  <p className="text-xs text-[#005F6A]/60 mt-1">
                    Alert when stock falls below this level
                  </p>
                </div>
              </div>

              {/* Global Error */}
              {globalError && (
                <div className="bg-red-50 rounded-2xl p-3">
                  <p className="text-xs text-red-600">{globalError}</p>
                </div>
              )}

              {/* Submit Button */}
              <div className="w-full flex flex-col md:flex-row justify-between items-center pt-4 gap-4">
                {/* Delete button on the left (only in edit mode) */}
                {mode === "edit" && !showDeleteConfirm && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="md"
                    border={false}
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={disableForm}
                    className="px-6 py-3 w-full md:w-auto">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Product
                  </Button>
                )}

                {mode === "create" && <div />}

                <div className="flex gap-3 w-full md:w-auto">
                  <Button
                    type="button"
                    variant="default"
                    size="md"
                    border={false}
                    onClick={handleClose}
                    disabled={disableForm}
                    className="px-6 py-3 flex-1 md:flex-none">
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    border={false}
                    type="submit"
                    disabled={disableForm}
                    className="px-6 py-3 flex-1 md:flex-none">
                    {submitting ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        {mode === "create" ? "Creating..." : "Updating..."}
                      </>
                    ) : (
                      <>
                        <Package className="w-4 h-4 mr-2" />
                        {mode === "create"
                          ? "Create Product"
                          : "Update Product"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
