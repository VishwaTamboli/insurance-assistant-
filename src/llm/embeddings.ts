import {
  GoogleGenerativeAIEmbeddings,
  type GoogleGenerativeAIEmbeddingsParams,
} from '@langchain/google-genai';
import { config } from '../config.ts';

// Changing either of these means embedding every chunk again: vectors from different
// models (or of different sizes) can't be compared with each other.
export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 768; // must match vector(768) in sql/001_policy_tables.sql

// The wrapper types taskType with an enum from Google's SDK that it doesn't re-export,
// so we take the type from the wrapper's own options instead.
type TaskType = NonNullable<GoogleGenerativeAIEmbeddingsParams['taskType']>;

// Gemini embeds a text differently depending on its job: a chunk that will be searched,
// or a query that searches. So we keep one embedder for each.
const chunkEmbedder = new GoogleGenerativeAIEmbeddings({
  apiKey: config.googleApiKey,
  model: EMBEDDING_MODEL,
  taskType: 'RETRIEVAL_DOCUMENT' as TaskType,
  outputDimensionality: EMBEDDING_DIMENSIONS,
});

const queryEmbedder = new GoogleGenerativeAIEmbeddings({
  apiKey: config.googleApiKey,
  model: EMBEDDING_MODEL,
  taskType: 'RETRIEVAL_QUERY' as TaskType,
  outputDimensionality: EMBEDDING_DIMENSIONS,
});

// Sent in batches of up to 100 texts per request.
// (LangChain calls any text a "document"; in this project a document is a whole policy.)
export async function embedChunks(texts: string[]): Promise<number[][]> {
  const vectors = await chunkEmbedder.embedDocuments(texts);
  vectors.forEach(checkSize);
  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const vector = await queryEmbedder.embedQuery(text);
  checkSize(vector);
  return vector;
}

// When a batch request fails, the wrapper doesn't throw: it quietly returns an empty
// vector for every text in that batch. Stop here instead of storing garbage.
function checkSize(vector: number[]) {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Got an embedding of ${vector.length} numbers instead of ${EMBEDDING_DIMENSIONS}. ` +
        `0 means a Gemini batch request failed, most often the free tier's limit of 100 texts ` +
        `per minute: wait a minute and run again. The wrapper hides the real error; ` +
        `call embedQuery() on one of the texts to see it.`,
    );
  }
}
