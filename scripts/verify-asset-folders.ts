/**
 * Uploaded files land in the right company's folder, and only that company's
 * photos can be attached to its bookings.
 *
 *   npx tsx scripts/verify-asset-folders.ts
 *
 * Everything used to go under one shared `cleano/` tree. That was untidy in the
 * obvious way — offboarding a company meant picking their files out of
 * everybody else's — and quietly wrong in a way that mattered more:
 * `isBookingPhotoUrl` accepts a photo that sits in the booking folder on our
 * cloud, and with ONE booking folder for the whole platform, a booking taken by
 * company A could carry a photo of company B's customer's home. Right cloud,
 * right folder, wrong company, and it passed.
 *
 * No database needed: this is string maths plus a read of the upload sites.
 */
import fs from "node:fs";
import path from "node:path";

import { bookingPhotoFolderFor, orgFolderFor, ASSET_ROOT } from "../src/lib/asset-paths";
import { isBookingPhotoUrl } from "../src/lib/booking-deposit";

let pass = 0,
  fail = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  ok    ${m}`);
};
const bad = (m: string, d = "") => {
  fail++;
  console.log(`  FAIL  ${m}${d ? ` — ${d}` : ""}`);
};

const CLOUD = "awer-cloud";
const MINE = bookingPhotoFolderFor("teamcleano");
const THEIRS = bookingPhotoFolderFor("acme-cleaning");
const url = (folder: string, cloud = CLOUD) =>
  `https://res.cloudinary.com/${cloud}/image/upload/v1/${folder}/photo.jpg`;

console.log("\nFOLDER SHAPE");
orgFolderFor("teamcleano") === `${ASSET_ROOT}/teamcleano`
  ? ok("a company's files live under awer/<slug>")
  : bad("orgFolderFor", orgFolderFor("teamcleano"));
MINE !== THEIRS
  ? ok("two companies get two different booking folders")
  : bad("booking folders collide", MINE);
!MINE.startsWith("cleano/")
  ? ok("the root is the platform's name, not the first customer's")
  : bad("root", MINE);

console.log("\nWHOSE PHOTO CAN BE ATTACHED TO WHOSE BOOKING");
isBookingPhotoUrl(url(MINE), CLOUD, MINE)
  ? ok("our own booking photo is accepted")
  : bad("own photo refused");
// The assertion this split exists for.
!isBookingPhotoUrl(url(THEIRS), CLOUD, MINE)
  ? ok("ANOTHER company's booking photo is refused")
  : bad("cross-company photo accepted", "one company can attach another's customer's home");
!isBookingPhotoUrl(url("cleano/booking-uploads"), CLOUD, MINE)
  ? ok("the old shared folder is refused too")
  : bad("legacy folder accepted");
!isBookingPhotoUrl(url(`${orgFolderFor("teamcleano")}/jobs/other-job`), CLOUD, MINE)
  ? ok("a different folder of our OWN is refused")
  : bad("wrong folder accepted");
!isBookingPhotoUrl(url(MINE, "someone-elses-cloud"), CLOUD, MINE)
  ? ok("another Cloudinary account is refused")
  : bad("foreign cloud accepted");
!isBookingPhotoUrl(url(MINE), CLOUD, "")
  ? ok("with no company resolved, everything is refused — fail closed")
  : bad("empty folder accepted");
!isBookingPhotoUrl(url(MINE), undefined, MINE)
  ? ok("with no cloud configured, everything is refused — fail closed")
  : bad("missing cloud accepted");

console.log("\nNO UPLOAD SITE STILL WRITES TO A SHARED FOLDER");
// Reads the source, because the failure this guards against is somebody adding
// an upload later and hardcoding a path, which no runtime check would notice
// until that company's files were already in the wrong place.
const offenders: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) {
      const src = fs.readFileSync(full, "utf8");
      if (!/folder:|upload_stream|uploader\.upload\(/.test(src)) continue;
      // A folder given as a literal rather than resolved from the company.
      for (const m of src.matchAll(/folder:\s*["'`]([^"'`]+)["'`]/g)) {
        offenders.push(`${full.replace("src/", "")} → "${m[1]}"`);
      }
    }
  }
};
walk("src");
offenders.length === 0
  ? ok("every upload resolves its folder from the company, none are hardcoded")
  : bad(`${offenders.length} hardcoded upload folder(s)`, offenders.join("; "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
