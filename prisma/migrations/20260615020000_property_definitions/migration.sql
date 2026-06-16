-- HubSpot-style property registry (additive). Creates PropertyDefinition and
-- seeds the default definitions that mirror the contact-record property cards.
CREATE TABLE "PropertyDefinition" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'everyone',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropertyDefinition_objectType_internalName_key" ON "PropertyDefinition"("objectType", "internalName");
CREATE INDEX "PropertyDefinition_objectType_idx" ON "PropertyDefinition"("objectType");

-- Seed default definitions (mirrors the contact record property cards).
INSERT INTO "PropertyDefinition"
  ("id","objectType","groupName","label","internalName","fieldType","options","isSystem","isRequired","isUnique","visibility","sortOrder","updatedAt")
VALUES
  (gen_random_uuid()::text,'contact','Contact info','Email','email','email',ARRAY[]::TEXT[],true,true,true,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Contact info','Phone','phone','phone',ARRAY[]::TEXT[],false,false,false,'everyone',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Contact info','Address','address','text',ARRAY[]::TEXT[],false,false,false,'everyone',3,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Contact info','Home type','home_type','dropdown',ARRAY['Condo','Apartment','House','Studio','Office'],false,false,false,'everyone',4,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Property','Bedrooms','bedrooms','number',ARRAY[]::TEXT[],false,false,false,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Property','Bathrooms','bathrooms','number',ARRAY[]::TEXT[],false,false,false,'everyone',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Property','Square feet','square_feet','number',ARRAY[]::TEXT[],false,false,false,'everyone',3,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Property','Parking','parking','dropdown',ARRAY['Street','Driveway','Garage','Lot','None'],false,false,false,'everyone',4,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Lead & source','Lifecycle stage','lifecycle','dropdown',ARRAY['New Lead','Qualified','Booked','Active','Returning','Past','Lost','Applicant','Cleaner','Do Not Contact'],true,true,false,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Lead & source','Original source','source','dropdown',ARRAY['Google','Instagram','Facebook','Referral','Word of mouth','Direct'],false,false,false,'everyone',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Lead & source','Campaign','campaign','text',ARRAY[]::TEXT[],false,false,false,'everyone',3,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Lead & source','Lead score','lead_score','number',ARRAY[]::TEXT[],false,false,false,'admin',4,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Lead & source','Owner','owner','user',ARRAY[]::TEXT[],true,false,false,'admin',5,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Booking','Frequency','frequency','dropdown',ARRAY['One-time','Weekly','Every 2 weeks','Monthly','Quarterly'],false,false,false,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Booking','Preferred cleaner','preferred_cleaner','user',ARRAY[]::TEXT[],false,false,false,'everyone',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Booking','First booked','first_booked','date',ARRAY[]::TEXT[],true,false,false,'everyone',3,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','Booking','Discount','discount','text',ARRAY[]::TEXT[],false,false,false,'everyone',4,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','System','Contact ID','contact_id','text',ARRAY[]::TEXT[],true,true,true,'admin',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','System','Created date','created_at','date',ARRAY[]::TEXT[],true,true,false,'admin',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'contact','System','Last activity','last_activity','date',ARRAY[]::TEXT[],true,false,false,'admin',3,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'company','Contact info','Company name','company_name','text',ARRAY[]::TEXT[],true,true,true,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'company','Contact info','Billing email','billing_email','email',ARRAY[]::TEXT[],false,false,false,'admin',2,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'company','Property','Sites','sites','number',ARRAY[]::TEXT[],false,false,false,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'booking','Booking','Service type','service_type','dropdown',ARRAY['Standard','Deep','Move-in','Move-out','Office'],true,true,false,'everyone',1,CURRENT_TIMESTAMP),
  (gen_random_uuid()::text,'booking','Booking','Add-ons','addons','multi',ARRAY['Inside oven','Inside fridge','Interior windows','Laundry & fold','Inside cabinets'],false,false,false,'everyone',2,CURRENT_TIMESTAMP);
