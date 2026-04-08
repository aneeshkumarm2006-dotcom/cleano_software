import React from "react";
import { Loader } from "lucide-react";

export default function loading() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-10rem)]">
      <div className="flex flex-col items-center gap-2">
        <Loader className="w-4 h-4 animate-spin" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
