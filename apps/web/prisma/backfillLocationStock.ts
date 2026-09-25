import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// One-time, idempotent backfill: seeds per-location stock for products that have
// global stock (Product.stockLevel > 0) but no InventoryLocationStock rows yet,
// so existing inventory becomes visible to cleaners in the pickup flow.
// Products that already have location stock (manually distributed) are left as-is.
async function main() {
  let location = await db.inventoryLocation.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (!location) {
    location = await db.inventoryLocation.create({
      data: { name: "Main Storage" },
      select: { id: true, name: true },
    });
    console.log(`Created default location "${location.name}".`);
  }

  const products = await db.product.findMany({
    where: { stockLevel: { gt: 0 } },
    select: { id: true, name: true, stockLevel: true },
  });

  let seeded = 0;
  for (const p of products) {
    const hasAny = await db.inventoryLocationStock.findFirst({
      where: { productId: p.id },
      select: { id: true },
    });
    if (hasAny) continue;

    await db.inventoryLocationStock.create({
      data: { locationId: location.id, productId: p.id, quantity: p.stockLevel },
    });
    seeded++;
    console.log(`  + ${p.name}: ${p.stockLevel} → ${location.name}`);
  }

  console.log(
    `Backfill complete. Seeded ${seeded} product(s) into "${location.name}".`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
