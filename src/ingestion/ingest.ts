import { basename } from 'node:path';
import { pool } from '../db/pool.ts';
import { embedChunks } from '../llm/embeddings.ts';
import { chunkPolicy, type Chunk } from './chunk.ts';
import { listPolicyFiles, readPolicyFile, type PolicyFile } from './policy-file.ts';

// Loads every policy file into Postgres: one policy_documents row per file,
// one policy_chunks row per chunk, with its embedding.
//
//   npm run ingest              new or changed files only
//   npm run ingest -- --force   every file again (e.g. after you change the chunking)
const force = process.argv.includes('--force');

for (const path of await listPolicyFiles()) {
  const policy = await readPolicyFile(path);
  const name = basename(path);

  if (!force && (await isStored(policy.contentHash))) {
    console.log(`${name}: unchanged, skipped`);
    continue;
  }

  const chunks = await chunkPolicy(policy.body);
  // Call Gemini before opening the transaction: a transaction should never wait on the network.
  const vectors = await embedChunks(chunks.map((chunk) => chunk.content));
  await store(policy, chunks, vectors);
  console.log(`${name}: stored ${chunks.length} chunks`);
}

await pool.end();

async function isStored(contentHash: string): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM policy_documents WHERE content_hash = $1',
    [contentHash],
  );
  return rows.length > 0;
}

// Writes one document and all its chunks in one transaction: either all of it is saved
// or, if anything fails, none of it. So a half-loaded policy can never exist.
async function store(policy: PolicyFile, chunks: Chunk[], vectors: number[][]) {
  const { header } = policy;
  const client = await pool.connect(); // a transaction has to stay on one connection
  try {
    await client.query('BEGIN');

    // Replace any older copy of this plan + country + version (the file changed, or --force).
    // ON DELETE CASCADE removes its chunks too.
    await client.query(
      'DELETE FROM policy_documents WHERE plan_code = $1 AND jurisdiction = $2 AND version = $3',
      [header.planCode, header.jurisdiction, header.version],
    );

    const { rows } = await client.query(
      `INSERT INTO policy_documents
         (plan_code, jurisdiction, version, title, effective_from, effective_to, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        header.planCode,
        header.jurisdiction,
        header.version,
        header.title,
        header.effectiveFrom,
        header.effectiveTo,
        policy.contentHash,
      ],
    );
    const documentId = rows[0].id;

    for (const [index, chunk] of chunks.entries()) {
      await client.query(
        `INSERT INTO policy_chunks (document_id, chunk_index, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          documentId,
          index,
          chunk.content,
          JSON.stringify(chunk.metadata),
          // pg would send a JS array as a Postgres array, "{0.1,0.2}"; pgvector wants "[0.1,0.2]".
          JSON.stringify(vectors[index]),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); // give the connection back to the pool
  }
}
