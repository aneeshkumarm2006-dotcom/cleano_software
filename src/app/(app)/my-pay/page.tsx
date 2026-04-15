import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  Banknote,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
} from "lucide-react";
import Card from "@/components/ui/Card";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PAID: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
};

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function MyPayPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const userId = session.user.id;

  const payouts = await db.payout.findMany({
    where: { employeeId: userId },
    include: { payPeriod: true },
    orderBy: { payPeriod: { startDate: "desc" } },
  });

  const currentPayout = payouts.find(
    (p) => p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
  );

  const paidPayouts = payouts.filter((p) => p.payPeriod.status === "PAID");
  const walletBalance = paidPayouts.reduce((sum, p) => sum + p.finalAmount, 0);
  const pendingAmount = payouts
    .filter(
      (p) =>
        p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
    )
    .reduce((sum, p) => sum + p.finalAmount, 0);

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const paidThisYear = paidPayouts
    .filter((p) => p.payPeriod.paidAt && p.payPeriod.paidAt >= yearStart)
    .reduce((sum, p) => sum + p.finalAmount, 0);

  const totalHoursYear = paidPayouts
    .filter((p) => p.payPeriod.paidAt && p.payPeriod.paidAt >= yearStart)
    .reduce((sum, p) => sum + p.totalHours, 0);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[#005F6A] flex items-center justify-center">
            <Banknote className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
              My Pay
            </h1>
            <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
              Track your earnings and payment history
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card variant="cleano_light" className="p-6 h-[7rem]">
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="app-title-small !text-[#005F6A]/70">
                  Wallet Balance
                </span>
                <DollarSign className="w-4 h-4 text-[#005F6A]/50" />
              </div>
              <p className="h2-title text-[#005F6A]">
                ${walletBalance.toFixed(2)}
              </p>
            </div>
          </Card>

          <Card variant="cleano_light" className="p-6 h-[7rem]">
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="app-title-small !text-[#005F6A]/70">
                  Pending
                </span>
                <Clock className="w-4 h-4 text-[#005F6A]/50" />
              </div>
              <p className="h2-title text-[#005F6A]">
                ${pendingAmount.toFixed(2)}
              </p>
            </div>
          </Card>

          <Card variant="cleano_light" className="p-6 h-[7rem]">
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="app-title-small !text-[#005F6A]/70">
                  Earned {now.getFullYear()}
                </span>
                <TrendingUp className="w-4 h-4 text-[#005F6A]/50" />
              </div>
              <p className="h2-title text-[#005F6A]">
                ${paidThisYear.toFixed(2)}
              </p>
            </div>
          </Card>

          <Card variant="cleano_light" className="p-6 h-[7rem]">
            <div className="h-full flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="app-title-small !text-[#005F6A]/70">
                  Hours {now.getFullYear()}
                </span>
                <Clock className="w-4 h-4 text-[#005F6A]/50" />
              </div>
              <p className="h2-title text-[#005F6A]">
                {totalHoursYear.toFixed(1)}h
              </p>
            </div>
          </Card>
        </div>

        {currentPayout && (
          <Card variant="cleano_light" className="p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-[#005F6A]" />
              <h2 className="text-lg font-[400] text-[#005F6A]">
                Current Pay Period
              </h2>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${STATUS_STYLES[currentPayout.payPeriod.status]}`}>
                {currentPayout.payPeriod.status}
              </span>
            </div>
            <p className="text-sm text-[#005F6A]/70 mb-4">
              {formatDate(currentPayout.payPeriod.startDate)} —{" "}
              {formatDate(currentPayout.payPeriod.endDate)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
                  Base
                </p>
                <p className="text-lg font-[400] text-[#005F6A]">
                  ${currentPayout.baseAmount.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
                  Adjustments
                </p>
                <p className="text-lg font-[400] text-blue-600">
                  ${currentPayout.adjustments.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
                  Deductions
                </p>
                <p className="text-lg font-[400] text-red-600">
                  -${currentPayout.deductions.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
                  Final
                </p>
                <p className="text-lg font-[500] text-[#005F6A]">
                  ${currentPayout.finalAmount.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-[#005F6A]/10 flex items-center gap-4 text-xs text-[#005F6A]/60">
              <span>{currentPayout.jobCount} jobs</span>
              <span>·</span>
              <span>{currentPayout.totalHours.toFixed(1)} hours</span>
            </div>
          </Card>
        )}

        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-[400] text-[#005F6A]">Pay History</h2>
        </div>

        {payouts.length === 0 ? (
          <div className="bg-white rounded-2xl">
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <Banknote className="w-8 h-8 text-[#005F6A]/40" />
              </div>
              <p className="text-sm font-[350] text-[#005F6A]/70">
                No pay periods yet
              </p>
              <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
                Your pay history will appear here once periods are created
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {payouts.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-[#005F6A]/10 p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-[#005F6A]/5 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-[#005F6A]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="app-title-small text-[#005F6A] font-[400]">
                        {formatDate(p.payPeriod.startDate)} —{" "}
                        {formatDate(p.payPeriod.endDate)}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${STATUS_STYLES[p.payPeriod.status]}`}>
                        {p.payPeriod.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-[#005F6A]/60">
                      <span>{p.jobCount} jobs</span>
                      <span>{p.totalHours.toFixed(1)}h</span>
                      {p.payPeriod.paidAt && (
                        <span>
                          Paid{" "}
                          {new Date(p.payPeriod.paidAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-[500] text-[#005F6A]">
                    ${p.finalAmount.toFixed(2)}
                  </p>
                  {p.adjustments !== 0 ||
                  p.deductions !== 0 ||
                  p.reimbursements !== 0 ? (
                    <p className="text-[10px] text-[#005F6A]/50">
                      Base ${p.baseAmount.toFixed(2)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
