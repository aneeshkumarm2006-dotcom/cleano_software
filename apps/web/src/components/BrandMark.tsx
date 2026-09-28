import Image from "next/image";

/**
 * The Bookmops symbol, sized for the small square logo tiles in the sidebars
 * and portal headers. Companies can't upload a logo of their own yet, so every
 * workspace shows this beside its own name. Decorative: the name next to it is
 * what screen readers announce.
 */
export default function BrandMark({ size = 18 }: { size?: number }) {
  // The symbol is wider than it is tall (256 × 110); fit its width to the tile.
  const width = Math.round(size * 1.35);
  return (
    <Image
      src="/brand/bookmops-symbol.png"
      alt=""
      aria-hidden
      width={width}
      height={Math.round((width * 110) / 256)}
      style={{ objectFit: "contain" }}
      priority
    />
  );
}
