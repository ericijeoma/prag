import type { SupabaseClient } from '@supabase/supabase-js';
import { ChunkRepository } from '../../infrastructure/supabase/chunk-repository.js';
import { RecursiveChunker } from '../../shared/chunking/recursive-chunker.js';
import { AppError } from '../../shared/http/errors.js';
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

export class IngestService {
  private readonly repo: ChunkRepository;
  private readonly chunker: RecursiveChunker;

  constructor(private readonly deps: { supabase: SupabaseClient; env: IngestEnv }) {
    this.repo = new ChunkRepository(deps.supabase);
    this.chunker = new RecursiveChunker({ minTokens: 300, maxTokens: 800, overlapTokens: 100 });
  }

  async ingest(input: IngestRequest): Promise<IngestResult> {
    if (!input.title?.trim() || !input.content?.trim()) {
      throw new AppError('title and content are required', { code: 'bad_request', status: 400 });
    }

    const traceId = input.trace_id ?? `trace_${Date.now()}`;
    await this.repo.logTrace({ traceId, stage: 'ingest.start', payload: { title: input.title } });

    // 1. Insert Document
    const { id: documentId } = await this.repo.insertDocument({
      title: input.title,
      content: this.normalizeText(input.content),
      metadata: { ...(input.metadata ?? {}), traceId },
      file_path: input.file_path ?? null,
      source_type: input.source_type ?? 'upload',
    });

    const chunks = this.chunker.chunk(input.content);

    // 2. Batch Chunk Text Insertion (1 Subrequest)
    const insertedChunks = await this.repo.batchInsertChunks(
      chunks.map((c) => ({
        document_id: documentId,
        chunk_index: c.index,
        chunk_text: c.text,
        chunk_metadata: { ...(input.metadata ?? {}), traceId, startChar: c.startChar, endChar: c.endChar },
      }))
    );

    // 3. Batch Embedding Call (1 Subrequest)
    const aiResult = await this.deps.env.AI.run(
      EMBEDDING_MODEL,
      { text: chunks.map((c) => c.text) } as unknown as { text: string }
    );

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

    await this.repo.logTrace({ traceId, stage: 'ingest.finish', payload: { chunksInserted: chunks.length } });

    return { documentId, chunksInserted: chunks.length, traceId };
  }

  private extractBatchEmbeddings(result: unknown): number[][] {
    const res = result as Record<string, unknown>;
    const data = (res?.data || res?.result || res) as unknown;
    
    if (Array.isArray(data) && Array.isArray(data[0]) && typeof data[0][0] === 'number') {
      return data as number[][];
    }
    
    throw new AppError('Invalid embedding response shape', { 
      code: 'internal_error', 
      status: 500 
    });
  }

  private normalizeText(text: string): string {
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/•/g, '\n• ').trim();
  }
}