"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import CustomDropdown from "@/components/ui/custom-dropdown";

interface JobTypeSelectorProps {
  initialValue?: string | null;
}

const jobTypeOptions = [
  { value: "", label: "Select Type" },
  { value: "R - Residential", label: "R - Residential" },
  { value: "C - Commercial", label: "C - Commercial" },
  { value: "PC - Post Construction", label: "PC - Post Construction" },
  { value: "F - Follow-up", label: "F - Follow-up" },
];

export default function JobTypeSelector({
  initialValue,
}: JobTypeSelectorProps) {
  const [jobType, setJobType] = useState(initialValue || "");

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
