import type { SupabaseClient } from '@supabase/supabase-js';
import { TENANT_ID } from '../../shared/config/constants.js';
import { AppError } from '../../shared/http/errors.js';

export type DocumentInsert = {
  id?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  file_path?: string | null;
  source_type?: string;
};

export type ChunkInsert = {
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  chunk_metadata?: Record<string, unknown>;
};

export type ChunkVectorInsert = {
  chunk_id: string;
  embedding: number[];
};

export type TraceInsert = {
  traceId: string;
  stage: string;
  payload: Record<string, unknown>;
};

export type SimilarChunk = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  chunk_text: string;
  chunk_metadata: Record<string, unknown>;
  parent_chunk_id?: string | null;
  score: number;
};

export class ChunkRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async logTrace(input: TraceInsert): Promise<void> {
    const { error } = await this.supabase.schema('public').rpc('prag_log_trace', {
      p_tenant_id: TENANT_ID,
      p_trace_id: input.traceId,
      p_stage: input.stage,
      p_payload: input.payload,
    });
    if (error) throw new AppError('Trace failed', { code: 'supabase_error', status: 500 });
  }

  async insertDocument(input: DocumentInsert): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_insert_document', {
      p_tenant_id: TENANT_ID,
      p_title: input.title,
      p_content: input.content,
      p_metadata: input.metadata ?? {},
      p_file_path: input.file_path ?? null,
      p_source_type: input.source_type ?? 'upload',
    });
    if (error) throw new AppError('Doc insert failed', { code: 'supabase_error', status: 500 });
    return { id: String(data) };
  }

  async batchInsertChunks(chunks: ChunkInsert[]): Promise<{ id: string; chunk_index: number }[]> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_batch_insert_chunks', {
      p_tenant_id: TENANT_ID,
      p_chunks: chunks,
    });

    if (error) {
      throw new AppError('Batch chunk insert failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }

    const rows = (data ?? []) as Array<{ out_id: string; out_chunk_index: number }>;
    return rows.map((item) => ({
      id: String(item.out_id),
      chunk_index: Number(item.out_chunk_index),
    }));
  }

  async batchInsertVectors(vectors: ChunkVectorInsert[]): Promise<void> {
    const { error } = await this.supabase
      .schema('knowledge')
      .from('chunk_vectors')
      .insert(
        vectors.map((v) => ({
          tenant_id: TENANT_ID,
          chunk_id: v.chunk_id,
          embedding: v.embedding,
        }))
      );

    if (error) {
      throw new AppError('Batch vector insert failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }
  }

  // Backward compatibility
  async insertChunk(input: ChunkInsert): Promise<{ id: string }> {
    const results = await this.batchInsertChunks([input]);
    return { id: results[0].id };
  }

  async insertChunkVector(input: ChunkVectorInsert): Promise<{ id: string }> {
    await this.batchInsertVectors([input]);
    return { id: input.chunk_id };
  }

  async similaritySearch(input: { embedding: number[]; topK?: number }): Promise<SimilarChunk[]> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_match_chunks', {
      p_tenant_id: TENANT_ID,
      p_query_embedding: input.embedding,
      p_match_count: input.topK ?? 5,
    });

    if (error) throw new AppError('Search failed', { code: 'supabase_error', status: 500 });

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      chunk_id: String(row.chunk_id),
      document_id: String(row.document_id),
      document_title: String(row.document_title ?? 'Unknown'),
      chunk_index: Number(row.chunk_index),
      chunk_text: String(row.chunk_text),
      chunk_metadata: (row.chunk_metadata as Record<string, unknown>) ?? {},
      parent_chunk_id: row.parent_chunk_id ? String(row.parent_chunk_id) : null,
      score: Number(row.score),
    }));
  }
}