// Generates test-bookings-dummy.csv in the EXACT BookingKoala export format
// (69 columns) for two test customers. Run: node scripts/gen-test-bookings.mjs
import { writeFileSync } from "node:fs";

const COLS = [
  "Client id","Transaction id","Date","Time","Booking start date time","Booking end date time",
  "First name","Last name","Full name","Company name","Exclude customer notifications","Email",
  "Apt","Address","City","State","Zip/Postal code","Phone","Service total (CAD)","Sales Tax",
  "Discounted total","Final amount (CAD)","Amount paid by customer (CAD)","Refunded amount (CAD)",
  "Tip (CAD)","Parking (CAD)","Bonus (CAD)","Payment method","Frequency","Occurrence","Discount code",
  "Discount from code (CAD)","Discount amount (CAD)","Discount from frequency (CAD)",
  "Discount from referral (CAD)","Giftcard amount used (CAD)","Provider details","Provider/team",
  "Provider/team (without ids)","Provider/team payment (CAD)","Provider payment (summary) (CAD)",
  "Provider/team has keys","Created on","Created by","Estimated job length (HH:MM)","Industry","Form",
  "Location","Location id","Location type","Service","Booking id","Customer id","Extras","Service fee",
  "Extra Bedrooms","Extra Bathrooms","Sq Ft","Transport Fee","Deep Carpet Cleaning","Apartment Type",
  "Extra Kitchen","Bedrooms","Full Bathrooms","Half Bathrooms","Items","Packages","Package addons","Addons",
];

// Per-row defaults that mirror the real export.
const DEF = {
  "Company name": "", "Exclude customer notifications": "false", "Apt": "",
  "Refunded amount (CAD)": "0.00", "Tip (CAD)": "0.00", "Parking (CAD)": "0.00", "Bonus (CAD)": "0.00",
  "Discount code": "", "Discount from code (CAD)": "0.00", "Discount amount (CAD)": "0.00",
  "Discount from frequency (CAD)": "0.00", "Discount from referral (CAD)": "0.00",
  "Giftcard amount used (CAD)": "0", "Provider/team has keys": "", "Location type": "Service Area",
  "Extras": "", "Service fee": "0.00", "Items": "", "Packages": "", "Package addons": "", "Addons": "",
};

const cleaner = (email, id, name, pay, phone) =>
  `  {\n    Email Id: ${email},\n    Id: ${id},\n    Name: ${name},\n    Payment Amount: ${pay},\n    Phone Number: ${phone}\n  }`;
const providerJson = (arr) => `[\n${arr.join(",\n")}\n]`;

const ALEX = (pay) => cleaner("testcleaner1@example.com", 9001, "Alex Tester", pay, 5145559001);
const JORDAN = (pay) => cleaner("testcleaner2@example.com", 9002, "Jordan Demo", pay, 5145559002);

// Customer constants
const C1 = { email: "premsaikilaru567@gmail.com", first: "Prem", last: "Sai", full: "Prem Sai",
  addr: "100 Rue Sainte-Catherine Ouest, Montreal, QC, Canada", city: "Montréal", zip: '="h2x1k4"', phone: "5145550001", cust: "8001" };
const C2 = { email: "20b91a12d9@gmail.com", first: "Test", last: "Customer", full: "Test Customer",
  addr: "200 Boulevard René-Lévesque Ouest, Montreal, QC, Canada", city: "Montréal", zip: '="h3b1a1"', phone: "5145550002", cust: "8002" };

function base(c, { date, time, start, end, booking }) {
  return {
    "Date": date, "Time": time, "Booking start date time": start, "Booking end date time": end,
    "First name": c.first, "Last name": c.last, "Full name": c.full, "Email": c.email,
    "Address": c.addr, "City": c.city, "State": "Québec", "Zip/Postal code": c.zip, "Phone": c.phone,
    "Booking id": booking, "Customer id": c.cust, "Created by": "Nettoyage Cleano",
  };
}

const rows = [
  // 1 — Prem · CC · 1 cleaner · PAID · Deep Cleaning (Form 4)
  { ...DEF, ...base(C1, { date: "06/25/2026", time: "09:00 AM", start: "2026-06-25T09:00:00-04:00", end: "2026-06-25T11:00:00-04:00", booking: "9001" }),
    "Client id": "cus_TEST001", "Transaction id": "pi_TEST001",
    "Service total (CAD)": "240.00", "Sales Tax": "35.95", "Discounted total": "240.00", "Final amount (CAD)": "275.95", "Amount paid by customer (CAD)": "275.95",
    "Payment method": "CC", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": providerJson([ALEX("96.00")]), "Provider/team": "9001: Alex Tester", "Provider/team (without ids)": "Alex Tester",
    "Provider/team payment (CAD)": "96.00", "Provider payment (summary) (CAD)": "Alex Tester: 96.00",
    "Created on": "2026-06-20", "Estimated job length (HH:MM)": "02:00", "Industry": "Residential Cleaning", "Form": "Form 4", "Location": "Montreal & Laval", "Location id": "64", "Service": "Deep Cleaning" },

  // 2 — Prem · Cash/Check · UNASSIGNED · unpaid · House (Form 1)
  { ...DEF, ...base(C1, { date: "06/27/2026", time: "10:00 AM", start: "2026-06-27T10:00:00-04:00", end: "2026-06-27T13:00:00-04:00", booking: "9002" }),
    "Client id": "", "Transaction id": "", "Created by": "Prem Sai",
    "Service total (CAD)": "180.00", "Sales Tax": "26.96", "Discounted total": "180.00", "Final amount (CAD)": "206.96", "Amount paid by customer (CAD)": "0.00",
    "Payment method": "Cash/Check", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": "", "Provider/team": "Unassigned", "Provider/team (without ids)": "Unassigned", "Provider/team payment (CAD)": "0.00", "Provider payment (summary) (CAD)": "",
    "Created on": "2026-06-21", "Estimated job length (HH:MM)": "03:00", "Industry": "Residential Cleaning", "Form": "Form 1", "Location": "Montreal & Laval", "Location id": "58", "Service": "House",
    "Bedrooms": "3", "Full Bathrooms": "1", "Half Bathrooms": "1" },

  // 3 — Prem · $0 · ON HOLD · Commercial (Form 4)
  { ...DEF, ...base(C1, { date: "07/01/2026", time: "10:00 AM", start: "2026-07-01T10:00:00-04:00", end: "2026-07-01T12:00:00-04:00", booking: "9003" }),
    "Client id": "", "Transaction id": "",
    "Service total (CAD)": "0.00", "Sales Tax": "0.00", "Discounted total": "0.00", "Final amount (CAD)": "0.00", "Amount paid by customer (CAD)": "0.00",
    "Payment method": "Cash/Check", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": "", "Provider/team": "Unassigned", "Provider/team (without ids)": "Unassigned", "Provider/team payment (CAD)": "0.00", "Provider payment (summary) (CAD)": "",
    "Created on": "2026-06-28", "Estimated job length (HH:MM)": "02:00", "Industry": "Commercial Cleaning", "Form": "Form 4", "Location": "Montreal & Laval", "Location id": "52", "Service": "Commercial" },

  // 4 — Prem · CC · 2 cleaners · PAID · Bi-Weekly recurring · House (Form 1)
  { ...DEF, ...base(C1, { date: "07/03/2026", time: "01:00 PM", start: "2026-07-03T13:00:00-04:00", end: "2026-07-03T16:00:00-04:00", booking: "9004" }),
    "Client id": "cus_TEST002", "Transaction id": "pi_TEST002",
    "Service total (CAD)": "225.00", "Sales Tax": "31.05", "Discounted total": "207.00", "Final amount (CAD)": "238.05", "Amount paid by customer (CAD)": "238.05",
    "Discount from frequency (CAD)": "18.00",
    "Payment method": "CC", "Frequency": "Bi Weekly (2 Cleanings/Month -8%)", "Occurrence": "recurring",
    "Provider details": providerJson([ALEX("90.00"), JORDAN("90.00")]),
    "Provider/team": "9001: Alex Tester, 9002: Jordan Demo", "Provider/team (without ids)": "Alex Tester, Jordan Demo",
    "Provider/team payment (CAD)": "180.00", "Provider payment (summary) (CAD)": "Alex Tester: 90.00, Jordan Demo: 90.00",
    "Created on": "2026-06-22", "Estimated job length (HH:MM)": "03:00", "Industry": "Residential Cleaning", "Form": "Form 1", "Location": "Montreal & Laval", "Location id": "58", "Service": "House",
    "Bedrooms": "4", "Full Bathrooms": "2", "Half Bathrooms": "1" },

  // 5 — Test Customer · CC · 1 cleaner · PAID · Move In & Out (Form 4)
  { ...DEF, ...base(C2, { date: "06/26/2026", time: "09:00 AM", start: "2026-06-26T09:00:00-04:00", end: "2026-06-26T12:00:00-04:00", booking: "9005" }),
    "Client id": "cus_TEST003", "Transaction id": "pi_TEST003",
    "Service total (CAD)": "300.00", "Sales Tax": "44.93", "Discounted total": "300.00", "Final amount (CAD)": "344.93", "Amount paid by customer (CAD)": "344.93",
    "Payment method": "CC", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": providerJson([JORDAN("120.00")]), "Provider/team": "9002: Jordan Demo", "Provider/team (without ids)": "Jordan Demo",
    "Provider/team payment (CAD)": "120.00", "Provider payment (summary) (CAD)": "Jordan Demo: 120.00",
    "Created on": "2026-06-21", "Estimated job length (HH:MM)": "03:00", "Industry": "Residential Cleaning", "Form": "Form 4", "Location": "Montreal & Laval", "Location id": "64", "Service": "Move In & Out" },

  // 6 — Test Customer · Cash/Check · 1 cleaner ASSIGNED · unpaid · Apartment (Form 1)
  { ...DEF, ...base(C2, { date: "06/29/2026", time: "02:00 PM", start: "2026-06-29T14:00:00-04:00", end: "2026-06-29T16:00:00-04:00", booking: "9006" }),
    "Client id": "", "Transaction id": "", "Created by": "Test Customer",
    "Service total (CAD)": "150.00", "Sales Tax": "22.46", "Discounted total": "150.00", "Final amount (CAD)": "172.46", "Amount paid by customer (CAD)": "0.00",
    "Payment method": "Cash/Check", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": providerJson([ALEX("60.00")]), "Provider/team": "9001: Alex Tester", "Provider/team (without ids)": "Alex Tester",
    "Provider/team payment (CAD)": "60.00", "Provider payment (summary) (CAD)": "Alex Tester: 60.00",
    "Created on": "2026-06-24", "Estimated job length (HH:MM)": "02:00", "Industry": "Residential Cleaning", "Form": "Form 1", "Location": "Montreal & Laval", "Location id": "58", "Service": "Apartment",
    "Bedrooms": "2", "Full Bathrooms": "1", "Half Bathrooms": "0" },

  // 7 — Test Customer · $0 · ON HOLD · Post Construction (Form 2)
  { ...DEF, ...base(C2, { date: "07/02/2026", time: "10:00 AM", start: "2026-07-02T10:00:00-04:00", end: "2026-07-02T15:00:00-04:00", booking: "9007" }),
    "Client id": "", "Transaction id": "",
    "Service total (CAD)": "0.00", "Sales Tax": "0.00", "Discounted total": "0.00", "Final amount (CAD)": "0.00", "Amount paid by customer (CAD)": "0.00",
    "Payment method": "Cash/Check", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": "", "Provider/team": "Unassigned", "Provider/team (without ids)": "Unassigned", "Provider/team payment (CAD)": "0.00", "Provider payment (summary) (CAD)": "",
    "Created on": "2026-06-29", "Estimated job length (HH:MM)": "05:00", "Industry": "Post Construction", "Form": "Form 2", "Location": "Montreal & Laval", "Location id": "46", "Service": "Post Construction Cleaning",
    "Packages": "2 Day Post Construction(1)" },

  // 8 — Test Customer · CC · UNASSIGNED · unpaid · Deep Cleaning (Form 4)
  { ...DEF, ...base(C2, { date: "07/05/2026", time: "11:00 AM", start: "2026-07-05T11:00:00-04:00", end: "2026-07-05T13:00:00-04:00", booking: "9008" }),
    "Client id": "cus_TEST004", "Transaction id": "pi_TEST004",
    "Service total (CAD)": "210.00", "Sales Tax": "31.45", "Discounted total": "210.00", "Final amount (CAD)": "241.45", "Amount paid by customer (CAD)": "0.00",
    "Payment method": "CC", "Frequency": "One-Time", "Occurrence": "onetime",
    "Provider details": "", "Provider/team": "Unassigned", "Provider/team (without ids)": "Unassigned", "Provider/team payment (CAD)": "0.00", "Provider payment (summary) (CAD)": "",
    "Created on": "2026-06-30", "Estimated job length (HH:MM)": "02:00", "Industry": "Residential Cleaning", "Form": "Form 4", "Location": "Montreal & Laval", "Location id": "64", "Service": "Deep Cleaning" },
];

// Serialize. Zip is emitted raw (Excel ="..." quirk); everything else is RFC-quoted as needed.
function field(col, val) {
  const v = val ?? "";
  if (col === "Zip/Postal code") return v; // raw ="..."
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
const lines = [COLS.join(",")];
for (const r of rows) lines.push(COLS.map((c) => field(c, r[c])).join(","));
const out = lines.join("\n") + "\n";
writeFileSync(new URL("../test-bookings-dummy.csv", import.meta.url), out);
console.log(`Wrote test-bookings-dummy.csv — ${rows.length} rows, ${COLS.length} columns`);
