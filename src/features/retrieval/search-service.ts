import type { SupabaseClient } from '@supabase/supabase-js';

import { ChunkRepository, type SimilarChunk } from '../../infrastructure/supabase/chunk-repository.js';
import type { RetrievalPort } from '../../shared/contracts/retrieval.js';
import { AppError } from '../../shared/http/errors.js';
import type { AiBinding } from '../../shared/types/ai';
import type { ChatTurn } from '../../shared/types/chat.js';

export type SearchEnv = {
  AI: AiBinding;
};

export type SearchRequest = {
  query: string;
  topK?: number;
  traceId?: string;
  chatHistory?: ChatTurn[];
  sessionId?: string | null;
  documentIds?: string[];
};

export type SearchResult = {
  query: string;
  results: SimilarChunk[];
};

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
const REWRITE_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

const MIN_SCORE = 0.45;
export const RAG_V3_MIN_SCORE = 0.45;

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
      if (nestedEmbedding) return nestedEmbedding;

      const nestedData = extractEmbedding(nested.data);
      if (nestedData) return nestedData;

      const nestedResult = extractEmbedding(nested.result);
      if (nestedResult) return nestedResult;
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
    console.log('DEBUG: SearchService received documentIds:', input.documentIds);
    if (!input.query?.trim()) {
      throw new AppError('query is required', { code: 'bad_request', status: 400 });
    }

    const topK = input.topK ?? 5;
    const fetchK = Math.max(topK * 2, 10);

    const rewrittenQuery = await this.rewriteQuery({
      currentQuery: input.query,
      chatHistory: input.chatHistory ?? [],
    });

    const embedding = await this.embed(rewrittenQuery);

    console.log('DEBUG: Calling similaritySearch with documentIds:', input.documentIds);
    const rawResults = await this.repo.similaritySearch({
      embedding,
      topK: fetchK,
      sessionId: input.sessionId ?? null,
      documentIds: input.documentIds,
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
    return { query: rewrittenQuery, results };
  }

  private buildRewritePrompt(chatHistory: ChatTurn[], currentQuery: string): string {
    const historyText = chatHistory
      .slice(-10)
      .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
      .join('\n');

    return [
      'You are a query rewriting component for a production RAG system.',
      'Rewrite the user query into a standalone, unambiguous query that resolves pronouns/coreferences.',
      'Do NOT answer the question. Do NOT add new facts.',
      'Output ONLY the rewritten query text, no quotes, no JSON.',
      '',
      'Chat History (most recent last):',
      historyText || '(empty)',
      '',
      `Current Query: ${currentQuery}`,
      'Rewritten Query:',
    ].join('\n');
  }

  private async rewriteQuery(input: { chatHistory: ChatTurn[]; currentQuery: string }): Promise<string> {
    if (input.chatHistory.length === 0) {
      return input.currentQuery.trim();
    }

    const prompt = this.buildRewritePrompt(input.chatHistory, input.currentQuery);

    const result: unknown = await this.deps.env.AI.run(REWRITE_MODEL, {
      messages: [
        { role: 'system', content: 'You rewrite queries for retrieval. Return only the rewritten query.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 128,
    });

    if (typeof result === 'string') {
      return result.trim() || input.currentQuery.trim();
    }

    if (typeof result === 'object' && result !== null) {
      const rec = result as Record<string, unknown>;

      if (typeof rec.result === 'object' && rec.result !== null) {
        const inner = rec.result as Record<string, unknown>;
        const response = inner.response;
        if (typeof response === 'string' && response.trim()) return response.trim();
      }

      if (typeof rec.response === 'string' && rec.response.trim()) return rec.response.trim();

      const choices = rec.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0] as unknown;
        if (typeof first === 'object' && first !== null) {
          const choiceRec = first as Record<string, unknown>;
          const message = choiceRec.message;
          if (typeof message === 'object' && message !== null) {
            const msgRec = message as Record<string, unknown>;
            const content = msgRec.content;
            if (typeof content === 'string' && content.trim()) return content.trim();
          }
        }
      }
    }

    return input.currentQuery.trim();
  }

  private async embed(text: string): Promise<number[]> {
    const result: unknown = await this.deps.env.AI.run(EMBEDDING_MODEL, { text });
    const vector = extractEmbedding(result);

    if (!vector) {
      const resultShape = typeof result === 'object' && result !== null ? Object.keys(result) : [];
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