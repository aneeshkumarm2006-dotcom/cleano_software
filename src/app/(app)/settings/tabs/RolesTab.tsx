"use client";

import { Check, X } from "lucide-react";
import { SectionCard } from "./_shared";

interface PermissionRow {
  feature: string;
  owner: boolean;
  admin: boolean;
  employee: boolean;
}

const PERMISSIONS: PermissionRow[] = [
  { feature: "Manage employees", owner: true, admin: true, employee: false },
  { feature: "Manage clients", owner: true, admin: true, employee: false },
  { feature: "Create / edit jobs", owner: true, admin: true, employee: false },
  {
    feature: "View own assigned jobs",
    owner: true,
    admin: true,
    employee: true,
  },
  { feature: "Clock in / out", owner: true, admin: true, employee: true },
  {
    feature: "Manage inventory & products",
    owner: true,
    admin: true,
    employee: false,
  },
  { feature: "Manage payouts", owner: true, admin: true, employee: false },
  {
    feature: "View own pay history",
    owner: true,
    admin: true,
    employee: true,
  },
  {
    feature: "Manage finances & budgets",
    owner: true,
    admin: true,
    employee: false,
  },
  { feature: "Generate invoices", owner: true, admin: true, employee: false },
  {
    feature: "Manage sales & marketing",
    owner: true,
    admin: true,
    employee: false,
  },
  {
    feature: "Configure app settings",
    owner: true,
    admin: true,
    employee: false,
  },
  {
    feature: "Manage admin accounts",
    owner: true,
    admin: false,
    employee: false,
  },
];

export default function RolesTab() {
  return (
    <SectionCard
      title="Roles & Permissions"
      description="Read-only overview of capabilities granted to each role.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3 font-[500]">Feature</th>
              <th className="py-2 pr-3 font-[500] text-center">Owner</th>
              <th className="py-2 pr-3 font-[500] text-center">Admin</th>
              <th className="py-2 font-[500] text-center">Employee</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              <tr
                key={row.feature}
                className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-3 text-gray-900">{row.feature}</td>
                <td className="py-2 pr-3 text-center">
                  <PermIcon allowed={row.owner} />
                </td>
                <td className="py-2 pr-3 text-center">
                  <PermIcon allowed={row.admin} />
                </td>
                <td className="py-2 text-center">
                  <PermIcon allowed={row.employee} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function PermIcon({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Check className="w-4 h-4 text-green-600 inline-block" />
  ) : (
    <X className="w-4 h-4 text-gray-300 inline-block" />
  );
}
