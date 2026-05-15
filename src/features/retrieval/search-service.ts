import type { SupabaseClient } from '@supabase/supabase-js';

import { ChunkRepository, type SimilarChunk } from '../../infrastructure/supabase/chunk-repository.js';
import type { RetrievalPort } from '../../shared/contracts/retrieval.js';
import { AppError } from '../../shared/http/errors.js';
import type { AiBinding } from '../../shared/types/ai';

export type SearchEnv = {
  AI: AiBinding;
};

export type SearchRequest = {
  query: string;
  topK?: number;
};

export type SearchResult = {
  query: string;
  results: SimilarChunk[];
};

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
const MIN_SCORE = 0.55;

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function extractEmbedding(result: unknown): number[] | null {
  if (isNumberArray(result)) {
    return result;
  }

  if (typeof result !== 'object' || result === null) {
    return null;
  }

  const record = result as {
    data?: unknown;
    embedding?: unknown;
    result?: unknown;
  };

  const candidates: unknown[] = [record.embedding, record.data, record.result];

  for (const candidate of candidates) {
    if (isNumberArray(candidate)) {
      return candidate;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (isNumberArray(item)) {
          return item;
        }

        if (typeof item === 'object' && item !== null) {
          const nested = item as { embedding?: unknown };
          if (isNumberArray(nested.embedding)) {
            return nested.embedding;
          }
        }
      }
    }

    if (typeof candidate === 'object' && candidate !== null) {
      const nested = candidate as { embedding?: unknown; data?: unknown; result?: unknown };
      const nestedEmbedding = extractEmbedding(nested.embedding);
      if (nestedEmbedding) {
        return nestedEmbedding;
      }

      const nestedData = extractEmbedding(nested.data);
      if (nestedData) {
        return nestedData;
      }

      const nestedResult = extractEmbedding(nested.result);
      if (nestedResult) {
        return nestedResult;
      }
    }
  }

  return null;
}

export class SearchService {
  private readonly repo: ChunkRepository;

  constructor(
    private readonly deps: {
      supabase: SupabaseClient;
      env: SearchEnv;
    },
  ) {
    this.repo = new ChunkRepository(deps.supabase);
  }

  async search(input: SearchRequest): Promise<SearchResult> {
    if (!input.query?.trim()) {
      throw new AppError('query is required', { code: 'bad_request', status: 400 });
    }

    const topK = input.topK ?? 5;
    const fetchK = Math.max(topK * 2, 10);

    const embedding = await this.embed(input.query);
    const rawResults = await this.repo.similaritySearch({
      embedding,
      topK: fetchK,
    });

    const deduped = new Map<string, SimilarChunk>();

    for (const chunk of rawResults) {
      if (chunk.score < MIN_SCORE) {
        continue;
      }

      const key = `${chunk.chunk_id}:${chunk.document_id}:${chunk.chunk_index}`;
      if (!deduped.has(key)) {
        deduped.set(key, chunk);
      }
    }

    const results = Array.from(deduped.values()).slice(0, topK);
    return { query: input.query, results };
  }

  private async embed(text: string): Promise<number[]> {
    const result: unknown = await this.deps.env.AI.run(EMBEDDING_MODEL, { text });
    const vector = extractEmbedding(result);

    if (!vector) {
      const resultShape =
        typeof result === 'object' && result !== null ? Object.keys(result) : [];
      throw new AppError('Workers AI embedding returned an unexpected shape', {
        code: 'internal_error',
        status: 500,
        details: { resultShape },
      });
    }

    return vector.map((value) => Number(value));
  }
}

type SearchServiceIsRetrievalPort = SearchService extends RetrievalPort ? true : false;
const _searchServiceContractCheck: SearchServiceIsRetrievalPort = true;
void _searchServiceContractCheck;