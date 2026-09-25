"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import CustomDropdown from "@/components/ui/custom-dropdown";
import {
  DEFAULT_SERVICE_CATALOG,
  resolveServiceValue,
  serviceOptions as catalogServiceOptions,
} from "@/lib/service-catalog";

interface JobTypeSelectorProps {
  initialValue?: string | null;
  /**
   * Service list from Settings → Job Types (item 20). This component used to
   * carry its own hardcoded list that also disagreed with the modal's about
   * what to STORE ("MOVE_IN - Move-in Cleaning" vs "MOVE_IN").
   */
  options?: { value: string; label: string }[];
}

export default function JobTypeSelector({
  initialValue,
  options = [],
}: JobTypeSelectorProps) {
  const jobTypeOptions = [
    { value: "", label: "Select Type" },
    ...(options.length > 0
      ? options
      : catalogServiceOptions(DEFAULT_SERVICE_CATALOG)),
  ];
  // A legacy stored value ("R - Residential") maps onto the offered service so
  // editing an old job doesn't blank its type.
  const [jobType, setJobType] = useState(() =>
    resolveServiceValue(
      initialValue,
      options.length > 0
        ? options.map((o) => ({
            id: o.value,
            name: o.label,
            category: o.value,
            isActive: true,
          }))
        : DEFAULT_SERVICE_CATALOG
    )
  );

  return (
    <>
      <input type="hidden" name="jobType" value={jobType} />
      <CustomDropdown
        trigger={
          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center !justify-between bg-white">
            <span>
              {jobTypeOptions.find((opt) => opt.value === jobType)?.label ||
                "Select Type"}
            </span>
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </Button>
        }
        options={jobTypeOptions.map((option) => ({
          label: option.label,
          onClick: () => {
            setJobType(option.value);
          },
        }))}
        variant="default"
      />
    </>
  );
}
