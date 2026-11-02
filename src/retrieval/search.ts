import { pool } from '../db/pool.ts';
import { embedQuery } from '../llm/embeddings.ts';

export interface SearchHit {
  id: string;
  section: string; // "3. Treatment abroad > 3.1 Emergency treatment in the territorial area"
  content: string;
  score: number;   // higher = better, but each search uses its own scale (see below)
}

// How many results each search hands over to the merge (the guide uses 40).
const CANDIDATES = 40;
// The constant in Reciprocal Rank Fusion. 60 is the usual choice.
const RRF_K = 60;

// Search by meaning. score = cosine similarity, as in piece 3 (1 = same meaning).
// <=> is pgvector's cosine distance, which is 1 minus the similarity.
export async function vectorSearch(documentId: string, query: string, limit = 10): Promise<SearchHit[]> {
  const vector = await embedQuery(query);
  const { rows } = await pool.query<SearchHit>(
    `SELECT id, metadata->>'section' AS section, content,
            1 - (embedding <=> $2::vector) AS score
     FROM policy_chunks
     WHERE document_id = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [documentId, JSON.stringify(vector), limit],
  );
  return rows;
}

// Search by words, after both sides are cut to their stems. A chunk matches only if it
// contains EVERY word of the query. score = ts_rank_cd: higher when the words appear
// more often and closer together.
export async function keywordSearch(documentId: string, query: string, limit = 10): Promise<SearchHit[]> {
  const { rows } = await pool.query<SearchHit>(
    `SELECT id, metadata->>'section' AS section, content,
            ts_rank_cd(content_tsv, terms) AS score
     FROM policy_chunks, websearch_to_tsquery('english', $2) AS terms
     WHERE document_id = $1 AND content_tsv @@ terms
     ORDER BY score DESC
     LIMIT $3`,
    [documentId, query, limit],
  );
  return rows;
}

// Both searches, merged with Reciprocal Rank Fusion (RRF): in each list, a chunk earns
// 1 / (60 + its rank), and a chunk found by both searches adds the two together.
// score = that sum. It uses ranks, not scores, because the two scales can't be compared.
export async function hybridSearch(documentId: string, query: string, limit = 10): Promise<SearchHit[]> {
  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearch(documentId, query, CANDIDATES),
    keywordSearch(documentId, query, CANDIDATES),
  ]);

  const merged = new Map<string, SearchHit>();
  for (const hits of [vectorHits, keywordHits]) {
    hits.forEach((hit, index) => {
      const rank = index + 1;
      const entry = merged.get(hit.id) ?? { ...hit, score: 0 };
      entry.score += 1 / (RRF_K + rank);
      merged.set(hit.id, entry);
    });
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
