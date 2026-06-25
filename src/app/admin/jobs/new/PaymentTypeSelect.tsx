"use client";

import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";

const PAYMENT_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "E_TRANSFER", label: "E-Transfer" },
  { value: "CREDIT_CARD", label: "Credit Card" },
  { value: "OTHER", label: "Other" },
];

interface PaymentTypeSelectProps {
  defaultValue?: string;
}

export default function PaymentTypeSelect({ defaultValue = "" }: PaymentTypeSelectProps) {
  const [value, setValue] = useState(defaultValue);
  return (
    <PremiumSelect
      name="paymentType"
      value={value}
      onChange={setValue}
      options={PAYMENT_OPTIONS}
      placeholder="— Select —"
      size="md"
    />
  );
}
