"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import { LogOut, Package } from "lucide-react";
import { clockOut } from "../actions/clockOut";

interface EmployeeProduct {
  id: string;
  productId: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    unit: string;
  };
}

interface ClockOutButtonProps {
  jobId: string;
  employeeProducts: EmployeeProduct[];
}

export default function ClockOutButton({
  jobId,
  employeeProducts,
}: ClockOutButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inventories, setInventories] = useState<{ [key: string]: string }>({});

  const handleOpenModal = () => {
    // Initialize inventories with current quantities
    const initial: { [key: string]: string } = {};
    employeeProducts.forEach((ep) => {
      initial[ep.productId] = ep.quantity.toString();
    });
    setInventories(initial);
    setShowModal(true);
  };

  const handleClockOut = async () => {
    setLoading(true);
    try {
      // Convert inventories to the format expected by the server action
      const productInventories = employeeProducts
        .map((ep) => ({
          productId: ep.productId,
          inventoryAfter: parseFloat(inventories[ep.productId] || "0"),
        }))
        .filter((inv) => !isNaN(inv.inventoryAfter));

      const result = await clockOut(jobId, productInventories);
      if (result.success) {
        setShowModal(false);
      } else {
        alert(result.error || "Failed to clock out");
      }
    } catch (error) {
      console.error("Error clocking out:", error);
      alert("Failed to clock out");
    } finally {
      setLoading(false);
    }
  };

  const handleInventoryChange = (productId: string, value: string) => {
    setInventories((prev) => ({
      ...prev,
      [productId]: value,
    }));
  };

  return (
    <>
      <Button
        variant="cleano"
        size="md"
        onClick={handleOpenModal}
        className="flex-1">
        <LogOut className="w-4 h-4 mr-2" />
        Clock Out
      </Button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Clock Out"
        className="max-w-2xl">
        <div className="space-y-4">
          <p className="text-sm text-neutral-950/70">
            Before clocking out, please update your product inventory levels.
            The system will calculate how much you&apos;ve used during this job.
          </p>

          {employeeProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-12 h-12 text-neutral-950/40 mx-auto mb-4" />
              <p className="text-sm text-neutral-950/60">
                No products assigned to you
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {employeeProducts.map((ep) => {
                const currentValue = parseFloat(
                  inventories[ep.productId] || "0"
                );
                const originalValue = ep.quantity;
                const used = originalValue - currentValue;

                return (
                  <div
                    key={ep.productId}
                    className="p-4 bg-neutral-950/10 rounded-lg border border-neutral-950/10">
                    <div className="flex items-start gap-4">
                      <div className="p-2 bg-neutral-950/10 rounded-lg">
                        <Package className="w-5 h-5 text-neutral-950" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-[400] text-neutral-950">
                              {ep.product.name}
                            </h4>
                            <p className="text-sm text-neutral-950/60">
                              Started with: {originalValue} {ep.product.unit}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Input
                            label={`Remaining ${ep.product.unit}`}
                            type="number"
                            step="0.01"
                            min="0"
                            max={originalValue}
                            value={inventories[ep.productId] || ""}
                            onChange={(e) =>
                              handleInventoryChange(
                                ep.productId,
                                e.target.value
                              )
                            }
                            placeholder="Enter remaining quantity"
                          />

                          {used > 0 && (
                            <div className="flex items-center justify-between text-sm p-2 bg-neutral-950/5 rounded">
                              <span className="text-neutral-950/70">
                                Amount used:
                              </span>
                              <span className="font-[400] text-neutral-950">
                                {used.toFixed(2)} {ep.product.unit}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={() => setShowModal(false)}
              disabled={loading}
              className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleClockOut}
              loading={loading}
              className="flex-1">
              Confirm Clock Out
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
