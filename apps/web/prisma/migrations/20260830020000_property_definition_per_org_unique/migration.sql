-- PropertyDefinition's uniqueness was left global when its ten siblings were
-- made per-organization in 20260826054325_per_org_unique_constraints.
--
-- Left as it was, the first company to define a CRM property called "Industry"
-- takes `industry` away from every other company on the platform. The failure
-- is also confusing and leaky rather than clean: the duplicate check in
-- propertyActions.ts is org-scoped, so it looks for the clash inside the
-- caller's own workspace, finds nothing, reports "available", and the insert
-- then fails on the global index. The company sees an unexplained error, and
-- that error reliably reveals that SOME other company already uses that
-- internal name. Internal names are derived from the label, so they are
-- trivially guessable: industry, source, region, owner, budget, notes.
--
-- Safe to apply: 25 rows in production, no (objectType, internalName) pair
-- occurs twice, so the new index builds without a collision.
DROP INDEX "public"."PropertyDefinition_objectType_internalName_key";

CREATE UNIQUE INDEX "PropertyDefinition_organizationId_objectType_internalName_key"
  ON "public"."PropertyDefinition"("organizationId", "objectType", "internalName");
