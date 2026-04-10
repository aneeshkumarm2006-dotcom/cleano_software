import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function SalesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-[#005F6A] flex items-center justify-center mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-3">Sales</h1>
      <p className="text-gray-500 text-lg mb-2">Coming Soon</p>
      <p className="text-gray-400 text-sm max-w-sm">
        Sales management is on its way. You&apos;ll be able to track and manage all sales activity from here.
      </p>
    </div>
  );
}
