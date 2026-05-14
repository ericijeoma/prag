import type { SupabaseClient } from '@supabase/supabase-js'

import { TENANT_ID } from '../../shared/config/constants.js'
import { AppError } from '../../shared/http/errors.js'

export type DocumentInsert = {
  id?: string
  title: string
  content: string
  metadata?: Record<string, unknown>
  file_path?: string | null
  source_type?: string
}

export type ChunkInsert = {
  id?: string
  document_id: string
  chunk_index: number
  chunk_text: string
  chunk_metadata?: Record<string, unknown>
}

export type ChunkVectorInsert = {
  id?: string
  chunk_id: string
  embedding: number[] // 384-dim
}

export type SimilarChunk = {
  chunk_id: string
  document_id: string
  chunk_index: number
  chunk_text: string
  chunk_metadata: Record<string, unknown>
  score: number
}

/**
 * Repository for knowledge.documents, knowledge.chunks, knowledge.chunk_vectors.
 */
export class ChunkRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async insertDocument(input: DocumentInsert): Promise<{ id: string }> {
    // RPC wrappers live in the `public` schema to avoid PostgREST multi-schema issues.
    const { data, error } = await this.supabase.schema('public').rpc('prag_insert_document', {
      p_tenant_id: TENANT_ID,
      p_title: input.title,
      p_content: input.content,
      p_metadata: input.metadata ?? {},
      p_file_path: input.file_path ?? null,
      p_source_type: input.source_type ?? 'upload',
    })

    if (error) {
      throw new AppError('Failed to insert document', {
        code: 'supabase_error',
        status: 500,
        details: { message: error.message, code: error.code, hint: error.hint, details: error.details },
      })
    }

    return { id: String(data) }
  }

  async insertChunk(input: ChunkInsert): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_insert_chunk', {
      p_tenant_id: TENANT_ID,
      p_document_id: input.document_id,
      p_chunk_index: input.chunk_index,
      p_chunk_text: input.chunk_text,
      p_chunk_metadata: input.chunk_metadata ?? {},
    })

    if (error) {
      throw new AppError('Failed to insert chunk', {
        code: 'supabase_error',
        status: 500,
        details: { message: error.message, code: error.code, hint: error.hint, details: error.details },
      })
    }

    return { id: String(data) }
  }

  async insertChunkVector(input: ChunkVectorInsert): Promise<{ id: string }> {
    if (!Array.isArray(input.embedding)) {
      throw new AppError('embedding must be a number[]', { code: 'bad_request', status: 400 })
    }
    if (input.embedding.length !== 384) {
      throw new AppError(`embedding must be 384-dim; got ${input.embedding.length}`, {
        code: 'bad_request',
        status: 400,
      })
    }

    const { data, error } = await this.supabase.schema('public').rpc('prag_insert_chunk_vector', {
      p_tenant_id: TENANT_ID,
      p_chunk_id: input.chunk_id,
      // supabase-js will serialize number[]; PostgREST coerces to vector(384)
      p_embedding: input.embedding,
    })

    if (error) {
      throw new AppError('Failed to insert chunk vector', {
        code: 'supabase_error',
        status: 500,
        details: { message: error.message, code: error.code, hint: error.hint, details: error.details },
      })
    }

    return { id: String(data) }
  }

  /**
   * Similarity search using pgvector.
   * Uses public.prag_match_chunks RPC wrapper which internally calls knowledge.match_chunks.
   * 
   */
  async similaritySearch(input: {
    embedding: number[]
    topK?: number
  }): Promise<SimilarChunk[]> {
    const topK = input.topK ?? 5
    if (input.embedding.length !== 384) {
      throw new AppError(`embedding must be 384-dim; got ${input.embedding.length}`, {
        code: 'bad_request',
        status: 400,
      })
    }

    const { data, error } = await this.supabase.schema('public').rpc('prag_match_chunks', {
      p_tenant_id: TENANT_ID,
      p_query_embedding: input.embedding,
      p_match_count: topK,
    })

    if (error) {
      throw new AppError('Similarity search failed', {
        code: 'supabase_error',
        status: 500,
        details: { message: error.message, code: error.code, hint: error.hint, details: error.details },
      })
    }

    return (data as Record<string, unknown>[]).map((row) => ({
      chunk_id: String(row.chunk_id),
      document_id: String(row.document_id),
      chunk_index: Number(row.chunk_index),
      chunk_text: String(row.chunk_text),
      chunk_metadata: (row.chunk_metadata ?? {}) as Record<string, unknown>,
      score: Number(row.score ?? row.similarity ?? row.distance ?? 0),
    }))
  }
}
