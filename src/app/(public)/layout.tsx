import { getSetting } from "@/lib/settings";

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const businessName = await getSetting("general.businessName");
  const initial = businessName.charAt(0).toUpperCase() || "C";

  return (
    <div className="min-h-screen bg-white">
      {/* Public Header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#008C9C] flex items-center justify-center">
              <span className="text-white text-sm font-[500]">{initial}</span>
            </div>
            <span className="text-lg font-[400] text-[#008C9C]">{businessName}</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-16">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center">
          <p className="text-xs text-gray-400">
            &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
