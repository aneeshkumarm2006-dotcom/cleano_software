// Removes the Cloudinary asset the void-cheque test uploaded. Must run BEFORE
// the EmployeeFile row is deleted — the row holds the only copy of publicId,
// and an `authenticated` delivery URL cannot be parsed back into one.
import { PrismaClient } from "@prisma/client";
import { v2 as cloudinary } from "cloudinary";

const COMMIT = process.argv.includes("--commit");
const db = new PrismaClient();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const files = await db.employeeFile.findMany({
  where: { employee: { email: { contains: "cleano-bt.local" } } },
  select: { id: true, publicId: true, resourceType: true, fileName: true },
});
console.log(`test-account Cloudinary assets: ${files.length}`);
for (const f of files) {
  console.log(`  ${f.fileName}  publicId=${f.publicId}  type=${f.resourceType}`);
  if (!COMMIT) continue;
  const res = await cloudinary.uploader.destroy(f.publicId, {
    resource_type: f.resourceType || "image",
    type: "authenticated",
    invalidate: true,
  });
  console.log(`    destroy → ${JSON.stringify(res)}`);
}
if (!COMMIT) console.log("DRY RUN — pass --commit to delete from Cloudinary.");
await db.$disconnect();
