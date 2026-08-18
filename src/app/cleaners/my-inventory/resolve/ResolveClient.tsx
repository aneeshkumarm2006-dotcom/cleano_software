"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  MapPin,
  Package,
  X,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { createInventoryRequest } from "@/app/admin/actions/createInventoryRequest";
import type { ProductLocationStock } from "@/app/admin/actions/getLocationStock.types";
import type { MissingEquipmentItem } from "@/app/admin/actions/checkEquipmentForJob.types";
import { fmtDate } from "@/lib/time";
import { jobTypeLabel } from "@/lib/calendar-labels";

interface JobInfo {
  id: string;
  clientName: string;
  jobDate: string | null;
  jobType: string | null;
  location: string | null;
  addOns: string[];
}

interface ResolveClientProps {
  job: JobInfo | null;
  missing: MissingEquipmentItem[];
  stockByProduct: Record<string, ProductLocationStock>;
}

export default function ResolveClient({
  job,
  missing,
  stockByProduct,
}: ResolveClientProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const visibleMissing = missing.filter((m) => !dismissed.has(m.productId));

  function dismissItem(productId: string) {
    setDismissed((prev) => new Set(prev).add(productId));
  }

  async function requestAll() {
    if (!job || visibleMissing.length === 0) return;
    setSubmitting(true);
    setFeedback(null);

    let allSucceeded = true;
    let lastError: string | null = null;

    for (const item of visibleMissing) {
      const res = await createInventoryRequest({
        productId: item.productId,
        quantity: item.shortBy,
        reason: `Equipment for ${job.clientName} (${
          job.jobType || "Job"
        }): missing ${item.shortBy} ${item.unit} of ${item.productName}`,
        jobId: job.id,
      });
      if (!res.success) {
        allSucceeded = false;
        lastError = res.error || "Request failed";
      }
    }

    setSubmitting(false);

    if (allSucceeded) {
      setFeedback({
        type: "success",
        text: `Equipment requested for ${visibleMissing.length} item(s). Admin will review.`,
      });
      setTimeout(() => router.refresh(), 800);
    } else {
      setFeedback({
        type: "error",
        text: lastError || "Some requests failed.",
      });
    }
  }

  async function requestOne(item: MissingEquipmentItem) {
    if (!job) return;
    setSubmitting(true);
    setFeedback(null);

    const res = await createInventoryRequest({
      productId: item.productId,
      quantity: item.shortBy,
      reason: `Equipment for ${job.clientName} (${
        job.jobType || "Job"
      }): missing ${item.shortBy} ${item.unit} of ${item.productName}`,
      jobId: job.id,
    });

    setSubmitting(false);

    if (res.success) {
      setFeedback({
        type: "success",
        text: `${item.productName} requested.`,
      });
      dismissItem(item.productId);
    } else {
      setFeedback({ type: "error", text: res.error || "Request failed." });
    }
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <Card variant="ghost">
          <h1 className="text-3xl font-[400] text-gray-900">
            Equipment Resolution
          </h1>
          <p className="text-sm text-[#008C9C]/70 mt-1">
            No job selected. Open this page from a job that has missing
            equipment.
          </p>
        </Card>
        <Button
          variant="ghost"
          size="md"
          submit={false}
          href="/cleaners/my-inventory">
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back to My Inventory
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card variant="ghost">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Button
              variant="ghost"
              size="sm"
              submit={false}
              href="/cleaners/my-inventory"
              className="!px-2 mb-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <h1 className="text-3xl font-[400] text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
              Missing Equipment
            </h1>
            <p className="text-sm text-[#008C9C]/70 mt-1">
              For job: <strong>{job.clientName}</strong>
              {job.jobDate &&
                ` · ${fmtDate(job.jobDate, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}`}
              {job.jobType && ` · ${jobTypeLabel(job.jobType)}`}
            </p>
            {job.addOns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {job.addOns.map((a) => (
                  <Badge
                    key={a}
                    variant="cleano"
                    size="xs"
                    className="!w-fit">
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {visibleMissing.length > 0 && (
            <Button
              variant="primary"
              size="md"
              submit={false}
              onClick={requestAll}
              disabled={submitting}>
              Request All ({visibleMissing.length})
            </Button>
          )}
        </div>
      </Card>

      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl text-sm ${
            feedback.type === "success"
              ? "bg-[#008C9C]/10 text-[#008C9C] border border-[#008C9C]/15"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
          {feedback.text}
        </div>
      )}

      {visibleMissing.length === 0 ? (
        <Card variant="default" className="p-8 text-center">
          <Check className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <h2 className="text-xl font-[400] text-gray-900 mb-1">
            You&apos;re all set
          </h2>
          <p className="text-sm text-gray-600">
            No missing equipment for this job.
            {missing.length > 0 &&
              dismissed.size > 0 &&
              ` (${dismissed.size} item(s) marked as resolved.)`}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleMissing.map((item) => {
            const stock = stockByProduct[item.productId];
            const availableLocations =
              stock?.locations.filter((l) => l.quantity > 0) || [];
            return (
              <Card
                key={item.productId}
                variant="default"
                className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <Package className="w-5 h-5 text-amber-600" />
                      <h3 className="text-lg font-[400] text-gray-900">
                        {item.productName}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      Need <strong>{item.needed}</strong> {item.unit}, you have{" "}
                      <strong>{item.have}</strong> {item.unit} (short by{" "}
                      <strong className="text-amber-700">
                        {item.shortBy}
                      </strong>{" "}
                      {item.unit})
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      submit={false}
                      onClick={() => dismissItem(item.productId)}
                      title="I already have this">
                      <X className="w-4 h-4 mr-1" />
                      I have this
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      submit={false}
                      onClick={() => requestOne(item)}
                      disabled={submitting}>
                      Request
                    </Button>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs uppercase tracking-wide text-[#005a63] mb-2">
                    Available at Locations
                  </p>
                  {!stock || stock.locations.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No location stock recorded.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {stock.locations.map((loc) => (
                        <div
                          key={loc.locationId}
                          className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-gray-500" />
                            <span className="text-gray-900">
                              {loc.locationName}
                            </span>
                            {loc.locationAddress && (
                              <span className="text-xs text-gray-500">
                                · {loc.locationAddress}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-sm ${
                              loc.quantity >= item.shortBy
                                ? "text-green-700 font-[400]"
                                : loc.quantity > 0
                                ? "text-amber-700"
                                : "text-gray-600"
                            }`}>
                            {loc.quantity} {item.unit} in stock
                            {loc.quantity >= item.shortBy && " ✓"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {availableLocations.length === 0 && stock && (
                    <p className="text-xs text-amber-700 mt-2">
                      ⚠ Not currently stocked at any location. Submit a request
                      so admin can re-supply.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
