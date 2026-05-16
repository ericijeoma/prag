import type { SupabaseClient } from '@supabase/supabase-js';
import { ChunkRepository } from '../../infrastructure/supabase/chunk-repository.js';
import { RecursiveChunker } from '../../shared/chunking/recursive-chunker.js';
import { AppError } from '../../shared/http/errors.js';
import { createTraceId } from '../../shared/trace/trace-id.js';
import type { AiBinding } from '../../shared/types/ai';

export type IngestEnv = { AI: AiBinding };
export type IngestRequest = {
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  file_path?: string | null;
  source_type?: string;
  trace_id?: string;
};
export type IngestResult = { documentId: string; chunksInserted: number; traceId: string };

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';

const CHILD_TOKENS = 300;
const PARENT_WINDOW_TOKENS = 1500;

function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractPageNumber(metadata: Record<string, unknown> | undefined, fallback: number): number {
  const m = metadata ?? {};
  const candidates: unknown[] = [m.page_number, m.page, m.pageNumber, m.pageIndex];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return Math.max(1, Math.floor(c));
    if (typeof c === 'string' && c.trim() && !Number.isNaN(Number(c))) return Math.max(1, Math.floor(Number(c)));
  }
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getParentWindowText(fullText: string, childStart: number, childEnd: number): string {
  const windowChars = PARENT_WINDOW_TOKENS * 4;
  const childMid = Math.floor((childStart + childEnd) / 2);
  const start = clamp(childMid - Math.floor(windowChars / 2), 0, fullText.length);
  const end = clamp(start + windowChars, 0, fullText.length);
  return fullText.slice(start, end).trim();
}

export class IngestService {
  private readonly repo: ChunkRepository;
  private readonly chunker: RecursiveChunker;

  constructor(private readonly deps: { supabase: SupabaseClient; env: IngestEnv }) {
    this.repo = new ChunkRepository(deps.supabase);
    // RAG V3: child chunks are stable (~300 tokens) for retrieval.
    this.chunker = new RecursiveChunker({ minTokens: CHILD_TOKENS, maxTokens: CHILD_TOKENS + 50, overlapTokens: 50 });
  }

  async ingest(input: IngestRequest): Promise<IngestResult> {
    if (!input.title?.trim() || !input.content?.trim()) {
      throw new AppError('title and content are required', { code: 'bad_request', status: 400 });
    }

    const traceId = input.trace_id ?? createTraceId();

    await this.repo.startIngestionJob({
      traceId,
      sourceType: input.source_type ?? 'upload',
      title: input.title,
      pageCount: Number(input.metadata?.pageCount ?? 0) || null,
    });

    try {
      await this.repo.logTrace({
        traceId,
        event_type: 'ingest',
        stage: 'ingest.start',
        payload: { title: input.title },
      });

      // 1. Insert Document
      const { id: documentId } = await this.repo.insertDocument({
        title: input.title,
        content: this.normalizeText(input.content),
        metadata: { ...(input.metadata ?? {}), traceId },
        file_path: input.file_path ?? null,
        source_type: input.source_type ?? 'upload',
      });

      const normalizedContent = this.normalizeText(input.content);

      // Child chunks: used for vector retrieval.
      const childChunks = this.chunker.chunk(normalizedContent);

      // V3 parent text: sliding window around each child chunk.
      // We store parent_text on each child row (no additional DB subrequests).

      // 2. Batch Chunk Text Insertion (1 Subrequest)
      const insertedChunks = await this.repo.batchInsertChunks(
        childChunks.map((c) => ({
          document_id: documentId,
          chunk_index: c.index,
          chunk_text: c.text,
          parent_text: getParentWindowText(normalizedContent, c.startChar, c.endChar),
          page_number: extractPageNumber(input.metadata, 1),
          is_child: true,
          chunk_metadata: {
            ...(input.metadata ?? {}),
            traceId,
            startChar: c.startChar,
            endChar: c.endChar,
            // Helpful for citations
            page_number: extractPageNumber(input.metadata, 1),
          },
        }))
      );

      // 3. Batch Embedding Call (1 Subrequest)
      const aiResult = await this.deps.env.AI.run(EMBEDDING_MODEL, { text: childChunks.map((c) => c.text) });

      const embeddings = this.extractBatchEmbeddings(aiResult);
      if (embeddings.length !== insertedChunks.length) {
        throw new AppError('Mismatched embedding count', { code: 'internal_error', status: 500 });
      }

      // 4. Batch Vector Insertion (1 Subrequest)
      await this.repo.batchInsertVectors(
        insertedChunks.map((ic, i) => ({
          chunk_id: ic.id,
          embedding: embeddings[i],
        }))
      );

      await this.repo.logTrace({
        traceId,
        event_type: 'ingest',
        stage: 'ingest.finish',
        payload: { chunksInserted: childChunks.length },
      });

      const inserted = childChunks.length;

      await this.repo.completeIngestionJob({
        traceId,
        chunkCount: inserted,
        pageCount: Number(input.metadata?.pageCount ?? 0) || null,
      });

      return { documentId, chunksInserted: inserted, traceId };
    } catch (error: unknown) {
      await this.repo.failIngestionJob({
        traceId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private extractBatchEmbeddings(result: unknown): number[][] {
    if (Array.isArray(result)) {
      const top = result as unknown[];
      if (top.length > 0 && Array.isArray(top[0])) {
        const vectors: number[][] = [];
        for (const item of top) {
          if (!Array.isArray(item)) {
            throw new AppError('Invalid embedding response shape', { code: 'internal_error', status: 500 });
          }
          const nums = item.map((n) => safeNumber(n)).filter((n): n is number => n !== null);
          if (nums.length === 0) {
            throw new AppError('Invalid embedding response shape', { code: 'internal_error', status: 500 });
          }
          vectors.push(nums);
        }
        return vectors;
      }
    }

    if (typeof result === 'object' && result !== null) {
      const rec = result as { data?: unknown; result?: unknown };
      const candidate = rec.data ?? rec.result;
      if (Array.isArray(candidate) && Array.isArray(candidate[0])) {
        const vectors: number[][] = [];
        for (const item of candidate as unknown[]) {
          if (!Array.isArray(item)) continue;
          const nums = item.map((n) => safeNumber(n)).filter((n): n is number => n !== null);
          if (nums.length > 0) vectors.push(nums);
        }
        if (vectors.length > 0) return vectors;
      }
    }

    throw new AppError('Invalid embedding response shape', {
      code: 'internal_error',
      status: 500,
    });
  }

  private normalizeText(text: string): string {
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/•/g, '\n• ').trim();
  }
}