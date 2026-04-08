"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Settings,
} from "lucide-react";
import { CalendarConfigProvider } from "@/contexts/CalendarConfigContext";

const calendarMenuItems = [
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    path: "/calendar",
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    path: "/calendar/settings",
  },
];

type MiniCalendarDay = {
  day: number;
  monthOffset: -1 | 0 | 1;
};

function CalendarLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());

  // Determine active menu item
  const getActiveMenuItem = () => {
    // Sort by path length (longest first) to match most specific routes first
    const sortedItems = [...calendarMenuItems].sort(
      (a, b) => b.path.length - a.path.length
    );

    for (const item of sortedItems) {
      if (pathname === item.path || pathname?.startsWith(item.path + "/")) {
        return item.id;
      }
    }
    return "calendar";
  };

  const activeMenuItem = getActiveMenuItem();
  const weekdayLabels = [
    { key: "mon", label: "M" },
    { key: "tue", label: "T" },
    { key: "wed", label: "W" },
    { key: "thu", label: "T" },
    { key: "fri", label: "F" },
    { key: "sat", label: "S" },
    { key: "sun", label: "S" },
  ];
  const monthLabel = miniCalendarDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
  const miniCalendarDays = useMemo<MiniCalendarDay[]>(() => {
    const year = miniCalendarDate.getFullYear();
    const month = miniCalendarDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Convert Sunday-first (0) to Monday-first index
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;

    const days: MiniCalendarDay[] = [];

    // Leading days from previous month
    for (let i = firstWeekday; i > 0; i--) {
      const day = daysInPrevMonth - i + 1;
      days.push({ day, monthOffset: -1 });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      days.push({ day, monthOffset: 0 });
    }

    // Trailing days from next month
    let nextMonthDay = 1;
    while (days.length % 7 !== 0) {
      days.push({ day: nextMonthDay++, monthOffset: 1 });
    }

    return days;
  }, [miniCalendarDate]);

  const changeMonth = (direction: "prev" | "next") => {
    setMiniCalendarDate((prev) => {
      const offset = direction === "next" ? 1 : -1;
      return new Date(prev.getFullYear(), prev.getMonth() + offset, 1);
    });
  };

  const today = new Date();

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left Sidebar Navigation */}
      <div className="w-[14rem] flex-shrink-0 bg-[#005F6A]/2 rounded-2xl !my-2 hidden">
        <div className="p-2 py-3 h-full overflow-y-auto flex flex-col gap-4">
          {/* Menu */}
          <div className="!p-0 flex-1">
            <h3 className="section-title mb-3 px-1">Navigation</h3>
            <div className="space-y-1">
              {calendarMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeMenuItem === item.id;

                return (
                  <Button
                    key={item.id}
                    variant={isActive ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => router.push(item.path)}
                    className="w-full flex items-center justify-start rounded-xl gap-3 !p-2.5">
                    <Icon className="w-4 h-4 text-[#005F6A]" />
                    <span className="text-[#005F6A]">{item.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Mini Month View */}
          <div className="mt-auto">
            <Card variant="ghost" className="!p-1 aspect-square flex flex-col">
              {/* Month Header */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="app-title-small">{monthLabel}</p>
                </div>
                {/* <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    border={false}
                    className="!p-1.5"
                    onClick={() => changeMonth("prev")}>
                    <ChevronLeft
                      className="w-4 h-4 text-[#005F6A]"
                      strokeWidth={1.5}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    border={false}
                    className="!p-1.5"
                    onClick={() => changeMonth("next")}>
                    <ChevronRight
                      className="w-4 h-4 text-[#005F6A]"
                      strokeWidth={1.5}
                    />
                  </Button>
                </div> */}
              </div>

              {/* Weekday Labels */}
              <div className="grid grid-cols-7 gap-2 app-title-small !font-[350] !mb-0">
                {weekdayLabels.map((day) => (
                  <span key={day.key} className="text-center">
                    {day.label}
                  </span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2 mt-3">
                {miniCalendarDays.map(({ day, monthOffset }, index) => {
                  const isCurrentMonth = monthOffset === 0;
                  const isToday =
                    isCurrentMonth &&
                    today.getDate() === day &&
                    today.getMonth() === miniCalendarDate.getMonth() &&
                    today.getFullYear() === miniCalendarDate.getFullYear();

                  return (
                    <div
                      key={`${monthOffset}-${day}-${index}`}
                      className={`h-4 flex items-center justify-center app-subtitle ${
                        isToday
                          ? "bg-[#D7F0F1] !text-[#005F6A] rounded-xl"
                          : isCurrentMonth
                          ? "!text-[#005F6A]"
                          : "!text-[#005F6A]/30"
                      }`}>
                      {day}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-hidden bg-white">{children}</div>
    </div>
  );
}

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CalendarConfigProvider>
      <CalendarLayoutContent>{children}</CalendarLayoutContent>
    </CalendarConfigProvider>
  );
}
