import { db } from "@/lib/org-db";

export interface ServiceAreaCheckResult {
  covered: boolean;
  prefix: string | null;
  zoneName?: string;
  travelFee?: number;
}

// Normalize a Canadian postal code or prefix to uppercase, no spaces.
// "h1a 2b3" → "H1A2B3". Returns the first 3 chars as the lookup prefix.
function normalizePostalPrefix(input: string): {
  full: string;
  prefix3: string;
  prefix2: string;
} {
  const cleaned = input.replace(/\s+/g, "").toUpperCase();
  return {
    full: cleaned,
    prefix3: cleaned.slice(0, 3),
    prefix2: cleaned.slice(0, 2),
  };
}

export async function checkServiceAreaInternal(
  postalInput: string
): Promise<ServiceAreaCheckResult> {
  const { prefix3, prefix2 } = normalizePostalPrefix(postalInput);

  if (!prefix3 || prefix3.length < 2) {
    return { covered: false, prefix: null };
  }

  // Prefer the more specific 3-char prefix, fall back to 2-char zone.
  const match = await db.serviceArea.findFirst({
    where: {
      isActive: true,
      OR: [{ prefix: prefix3 }, { prefix: prefix2 }],
    },
    orderBy: { prefix: "desc" },
  });

  if (!match) {
    return { covered: false, prefix: prefix3 };
  }

  return {
    covered: true,
    prefix: match.prefix,
    zoneName: match.zoneName,
    travelFee: match.travelFee,
  };
}
