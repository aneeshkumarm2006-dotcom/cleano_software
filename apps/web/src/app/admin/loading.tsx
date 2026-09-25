import CleanoLoader from "@/components/ui/CleanoLoader";

export default function Loading() {
  // Center within the app content area (viewport minus the main's vertical
  // padding), so the loader sits in the true middle rather than the top third.
  return (
    <div
      className="flex items-center justify-center"
      style={{ minHeight: "calc(100dvh - 120px)" }}
    >
      <CleanoLoader size={72} />
    </div>
  );
}
