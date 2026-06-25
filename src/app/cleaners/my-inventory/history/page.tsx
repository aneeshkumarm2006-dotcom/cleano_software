import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCheckoutHistory } from "@/app/admin/actions/getCheckoutHistory";
import HistoryClient from "./HistoryClient";

type SearchParams = Promise<{
  start?: string;
  end?: string;
}>;

export default async function CheckoutHistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const result = await getCheckoutHistory({
    startDate: params.start,
    endDate: params.end,
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <HistoryClient
        checkouts={result.success ? result.checkouts : []}
        error={result.success ? null : result.error}
        initialStart={params.start ?? ""}
        initialEnd={params.end ?? ""}
      />
    </div>
  );
}
