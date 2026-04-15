"use client";

import Button from "@/components/ui/Button";
import {
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Percent,
  Gift,
} from "lucide-react";

export type JobSubTab =
  | "all"
  | "upcoming"
  | "completed"
  | "overdue"
  | "discounted"
  | "free";

interface JobsSubTabsProps {
  active: JobSubTab;
  onChange: (tab: JobSubTab) => void;
  counts?: Partial<Record<JobSubTab, number>>;
}

const TABS: Array<{
  id: JobSubTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "all", label: "All", icon: <Calendar className="w-4 h-4" /> },
  { id: "upcoming", label: "Upcoming", icon: <Calendar className="w-4 h-4" /> },
  {
    id: "completed",
    label: "Completed",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  {
    id: "overdue",
    label: "Overdue",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  {
    id: "discounted",
    label: "Discounted",
    icon: <Percent className="w-4 h-4" />,
  },
  { id: "free", label: "Free", icon: <Gift className="w-4 h-4" /> },
];

export default function JobsSubTabs({
  active,
  onChange,
  counts = {},
}: JobsSubTabsProps) {
  return (
    <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 mb-4 w-fit overflow-x-auto">
      {TABS.map((t) => {
        const isActive = active === t.id;
        const count = counts[t.id];
        return (
          <Button
            key={t.id}
            border={false}
            onClick={() => onChange(t.id)}
            variant={isActive ? "action" : "ghost"}
            size="md"
            className="rounded-xl px-4 md:px-5 py-2.5 whitespace-nowrap">
            <span className="mr-2 hidden sm:inline">{t.icon}</span>
            {t.label}
            {typeof count === "number" && (
              <span className="ml-2 text-xs opacity-70">({count})</span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
