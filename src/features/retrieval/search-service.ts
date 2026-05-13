import type { SupabaseClient } from '@supabase/supabase-js'

import { ChunkRepository, type SimilarChunk } from '../../infrastructure/supabase/chunk-repository.js'

export type AiEmbeddingResponse = {
  data?: number[][] | number[]
  embedding?: number[]
  result?: number[]
}

export type AiBinding = {
  run(model: string, inputs: string | { text: string }): Promise<AiEmbeddingResponse>
}

export type SearchEnv = {
  AI: AiBinding
}

export type SearchRequest = {
  query: string
  topK?: number
}

export type SearchResult = {
  query: string
  results: SimilarChunk[]
}

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5'

export class SearchService {
  private readonly repo: ChunkRepository

  constructor(
    private readonly deps: {
      supabase: SupabaseClient
      env: SearchEnv
    },
  ) {
    this.repo = new ChunkRepository(deps.supabase)
  }

  async search(input: SearchRequest): Promise<SearchResult> {
    if (!input.query?.trim()) throw new Error('query is required')
    const topK = input.topK ?? 5

    const embedding = await this.embed(input.query)
    const results = await this.repo.similaritySearch({ embedding, topK })
    return { query: input.query, results }
  }

  private async embed(text: string): Promise<number[]> {
    const result = await this.deps.env.AI.run(EMBEDDING_MODEL, { text })
    const vector =
      (result?.data?.[0] as number[] | undefined) ??
      (result?.data as number[] | undefined) ??
      (result?.embedding as number[] | undefined) ??
      (result?.result as number[] | undefined)

    if (!vector || !Array.isArray(vector)) {
      throw new Error('Workers AI embedding returned an unexpected shape')
    }
    return vector
  }
}
