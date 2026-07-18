import { redirect } from "next/navigation";

// The rag-wash tracking system was removed (spec item 23). Payouts and their
// history live on — this stub keeps old links/bookmarks from 404-ing.
export default function RagWashRemovedRedirect() {
  redirect("/admin/wash-payouts");
}
