"use client";

import { Check, X, Shield } from "lucide-react";
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
      description="Read-only overview of capabilities granted to each role."
      icon={Shield}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-[#005F6A]/10">
              <th className="py-3 pr-3 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide">
                Feature
              </th>
              <th className="py-3 pr-3 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide text-center">
                Owner
              </th>
              <th className="py-3 pr-3 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide text-center">
                Admin
              </th>
              <th className="py-3 text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide text-center">
                Employee
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              <tr
                key={row.feature}
                className="border-b border-[#005F6A]/5 last:border-0">
                <td className="py-3 pr-3 text-sm text-[#005F6A]">
                  {row.feature}
                </td>
                <td className="py-3 pr-3 text-center">
                  <PermIcon allowed={row.owner} />
                </td>
                <td className="py-3 pr-3 text-center">
                  <PermIcon allowed={row.admin} />
                </td>
                <td className="py-3 text-center">
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
    <Check className="w-4 h-4 text-[#005F6A] inline-block" />
  ) : (
    <X className="w-4 h-4 text-[#005F6A]/20 inline-block" />
  );
}
