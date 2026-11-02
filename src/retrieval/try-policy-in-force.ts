import { pool } from '../db/pool.ts';
import { findPolicyInForce } from './policy-in-force.ts';

// Which policy document applies? A few cases, including the expired-version trap.
// Reads the database only: no Gemini call.
const cases = [
  { plan: 'GOLD', country: 'FR', date: '2026-10-27', why: 'today' },
  { plan: 'GOLD', country: 'FR', date: '2025-06-15', why: 'a claim for treatment last June' },
  { plan: 'GOLD', country: 'US', date: '2026-10-27', why: 'same plan name, other country' },
  { plan: 'SILVER', country: 'FR', date: '2025-06-15', why: 'Silver starts on 2026-01-01' },
  { plan: 'PLATINUM', country: 'DE', date: '2026-10-27', why: 'no German policies at all' },
];

for (const { plan, country, date, why } of cases) {
  const policy = await findPolicyInForce(plan, country, date);
  const found = policy ? `${policy.title}, version ${policy.version}` : 'none';
  console.log(`${plan} ${country}, ${date}`.padEnd(24), '→', found.padEnd(46), `(${why})`);
}

await pool.end();
