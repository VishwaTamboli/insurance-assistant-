import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool.ts';

// Runs every file in sql/ in name order (001_, 002_, ...). Each file is safe to run
// again, so there's no bookkeeping table recording which files already ran.
const sqlDir = new URL('../../sql/', import.meta.url);
const files = (await readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  await pool.query(await readFile(new URL(file, sqlDir), 'utf8'));
  console.log(`ran ${file}`);
}

const { rows } = await pool.query(
  `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
);
console.log(`pgvector ${rows[0].extversion} is installed`);

await pool.end();
