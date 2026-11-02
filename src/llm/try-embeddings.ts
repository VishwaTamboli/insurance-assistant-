import { join } from 'node:path';
import { chunkPolicy } from '../ingestion/chunk.ts';
import { policiesDir, readPolicyFile } from '../ingestion/policy-file.ts';
import { embedChunks, embedQuery } from './embeddings.ts';

// A first look at embeddings: embed Gold FR 2026's chunks and two questions, then rank
// the chunks by how close their meaning is to each question. That's vector search done
// by hand, in memory; piece 6 lets Postgres do it. Costs a tiny fraction of a cent.

const { body } = await readPolicyFile(join(policiesDir, 'gold-fr-2026.md'));
const chunks = await chunkPolicy(body);
const chunkVectors = await embedChunks(chunks.map((chunk) => chunk.content));

const first = chunkVectors[0].slice(0, 4).map((n) => n.toFixed(4));
console.log(`Embedded ${chunks.length} chunks. Each is ${chunkVectors[0].length} numbers: [${first.join(', ')}, …]`);

const questions = [
  'Am I covered for surgery in Spain?', // how a member asks it; no chunk mentions Spain
  'emergency surgery abroad',           // how the query expander (step 4) will reword it
  'Do I need prior authorization?',     // US spelling; the policy says "pre-authorisation"
];

for (const question of questions) {
  const questionVector = await embedQuery(question);
  const ranked = chunks
    .map((chunk, i) => ({
      section: chunk.metadata.section,
      similarity: cosineSimilarity(questionVector, chunkVectors[i]),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  console.log(`\n"${question}" (top 5 of ${ranked.length})`);
  for (const { similarity, section } of ranked.slice(0, 5)) {
    console.log(`  ${similarity.toFixed(3)}  ${section}`);
  }
}

// How close two vectors point: 1 = same direction (same meaning), 0 = unrelated.
// pgvector's <=> operator, used in piece 6, returns 1 minus this (the "cosine distance").
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let lengthA = 0;
  let lengthB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    lengthA += a[i] * a[i];
    lengthB += b[i] * b[i];
  }
  return dot / Math.sqrt(lengthA * lengthB);
}
