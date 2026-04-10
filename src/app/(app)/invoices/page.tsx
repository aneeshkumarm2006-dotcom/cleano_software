import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function InvoicesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-[#005F6A] flex items-center justify-center mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Invoices</h1>
      <p className="text-gray-500 text-lg mb-2">Coming Soon</p>
      <p className="text-gray-400 text-sm max-w-sm">
        Invoice management is on its way. You&apos;ll be able to create and manage all invoices from here.
      </p>
    </div>
  );
}
