import { pool } from '../db/pool.ts';

export interface PolicyDocument {
  id: string;
  planCode: string;
  jurisdiction: string;
  version: string;
  title: string;
  effectiveFrom: string;      // "2026-01-01"
  effectiveTo: string | null; // null = still in force
}

// The ONE policy document that applies to this plan, in this country, on this date
// (the date of treatment, which isn't always today). Search only looks at this
// document's chunks, so last year's wording can never reach an answer.
//
// The ::text casts keep dates as "2026-01-01" strings; without them pg turns a
// date column into a JS Date at local midnight, which can shift the day.
export async function findPolicyInForce(
  planCode: string,
  jurisdiction: string,
  date: string, // "2026-10-27"
): Promise<PolicyDocument | null> {
  const { rows } = await pool.query<PolicyDocument>(
    `SELECT id, plan_code AS "planCode", jurisdiction, version, title,
            effective_from::text AS "effectiveFrom",
            effective_to::text   AS "effectiveTo"
     FROM policy_documents
     WHERE plan_code = $1
       AND jurisdiction = $2
       AND effective_from <= $3
       AND (effective_to IS NULL OR effective_to >= $3)`,
    [planCode, jurisdiction, date],
  );

  // Two versions in force on the same day means the dates in the policy files overlap.
  // Quietly picking one would hide that mistake, so stop instead.
  if (rows.length > 1) {
    const versions = rows.map((row) => row.version).join(', ');
    throw new Error(`${planCode} ${jurisdiction}: ${rows.length} versions in force on ${date} (${versions}). Fix their effective dates.`);
  }

  return rows[0] ?? null;
}

// All policies currently available in one jurisdiction on the same treatment date.
// Ordinary questions do not call this; it is reserved for explicit comparisons without
// a named second plan.
export async function findPoliciesInForce(jurisdiction: string, date: string): Promise<PolicyDocument[]> {
  const { rows } = await pool.query<PolicyDocument>(
    `SELECT id, plan_code AS "planCode", jurisdiction, version, title,
            effective_from::text AS "effectiveFrom",
            effective_to::text   AS "effectiveTo"
     FROM policy_documents
     WHERE jurisdiction = $1
       AND effective_from <= $2
       AND (effective_to IS NULL OR effective_to >= $2)
     ORDER BY plan_code`,
    [jurisdiction, date],
  );
  const versions = new Map<string, string[]>();
  for (const row of rows) versions.set(row.planCode, [...(versions.get(row.planCode) ?? []), row.version]);
  for (const [planCode, activeVersions] of versions) {
    if (activeVersions.length > 1) {
      throw new Error(`${planCode} ${jurisdiction}: ${activeVersions.length} versions in force on ${date} (${activeVersions.join(', ')}). Fix their effective dates.`);
    }
  }
  return rows;
}
