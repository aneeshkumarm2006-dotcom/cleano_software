"use client";

import { useState } from "react";
import { Download, FileText, Loader } from "lucide-react";
import Button from "@/components/ui/Button";
import CustomDropdown from "@/components/ui/custom-dropdown";
import { exportJobs } from "../actions/exportJobs";

interface ExportButtonProps {
  filters: {
    startDate?: string;
    endDate?: string;
    jobType?: string;
    clientId?: string;
    employeeId?: string;
    paymentType?: string;
    status?: string;
    discountedOnly?: boolean;
    unpaidOnly?: boolean;
  };
}

export default function ExportButton({ filters }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const doExport = async (format: "csv" | "pdf") => {
    setBusy(true);
    try {
      const result = await exportJobs({ ...filters, format });
      if ("error" in result) {
        alert(result.error);
        return;
      }
      const mime = format === "csv" ? "text/csv" : "text/plain";
      const blob = new Blob([result.content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomDropdown
      trigger={
        <Button
          variant="default"
          size="md"
          border={false}
          disabled={busy}
          className="h-[42px] px-4 py-3 flex items-center gap-2">
          {busy ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span className="text-sm font-[350]">Export</span>
        </Button>
      }
      options={[
        {
          label: "CSV",
          onClick: () => doExport("csv"),
        },
        {
          label: "PDF / Text",
          onClick: () => doExport("pdf"),
        },
      ]}
      maxHeight="12rem"
    />
  );
}
