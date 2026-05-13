import type { SupabaseClient } from '@supabase/supabase-js'

import { TENANT_ID } from '../../shared/config/constants.js'

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
    const payload = {
      ...input,
      tenant_id: TENANT_ID,
      metadata: input.metadata ?? {},
      source_type: input.source_type ?? 'upload',
    }

    const { data, error } = await this.supabase
      .schema('knowledge')
      .from('documents')
      .insert(payload)
      .select('id')
      .single()

    if (error) throw new Error(`Failed to insert document: ${error.message}`)
    return { id: data.id as string }
  }

  async insertChunk(input: ChunkInsert): Promise<{ id: string }> {
    const payload = {
      ...input,
      tenant_id: TENANT_ID,
      chunk_metadata: input.chunk_metadata ?? {},
    }

    const { data, error } = await this.supabase
      .schema('knowledge')
      .from('chunks')
      .insert(payload)
      .select('id')
      .single()

    if (error) throw new Error(`Failed to insert chunk: ${error.message}`)
    return { id: data.id as string }
  }

  async insertChunkVector(input: ChunkVectorInsert): Promise<{ id: string }> {
    if (!Array.isArray(input.embedding)) throw new Error('embedding must be a number[]')
    if (input.embedding.length !== 384) {
      throw new Error(`embedding must be 384-dim; got ${input.embedding.length}`)
    }

    const payload = {
      ...input,
      tenant_id: TENANT_ID,
    }

    const { data, error } = await this.supabase
      .schema('knowledge')
      .from('chunk_vectors')
      .insert(payload)
      .select('id')
      .single()

    if (error) throw new Error(`Failed to insert chunk vector: ${error.message}`)
    return { id: data.id as string }
  }

  /**
   * Similarity search using pgvector.
   *
   * Notes:
   * - We don't have an RPC in migrations; so we use a SQL query via the PostgREST
   *   query endpoint is not available in supabase-js.
   * - Therefore we perform similarity using an RPC-like SQL function created on the fly
   *   would be wrong. Instead, we approximate with an `order` on an exposed computed column
   *   is not possible either.
   *
   * So: we rely on a Supabase SQL function `knowledge.match_chunks` if it exists.
   * If it doesn't exist in your DB, add it in a follow-up migration.
   */
  async similaritySearch(input: {
    embedding: number[]
    topK?: number
  }): Promise<SimilarChunk[]> {
    const topK = input.topK ?? 5
    if (input.embedding.length !== 384) {
      throw new Error(`embedding must be 384-dim; got ${input.embedding.length}`)
    }

    const { data, error } = await this.supabase.rpc('match_chunks', {
      p_tenant_id: TENANT_ID,
      p_query_embedding: input.embedding,
      p_match_count: topK,
    })

    if (error) {
      throw new Error(
        `Similarity search failed (expected RPC knowledge.match_chunks): ${error.message}`,
      )
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
