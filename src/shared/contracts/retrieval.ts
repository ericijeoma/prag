// This contract is the only thing the agent feature is
// allowed to know about retrieval. The concrete implementation
// lives in features/retrieval — never imported by agent directly.

export interface ChunkResult {
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  chunk_text: string;
  score: number;
}

export interface RetrievalPort {
  search(input: { query: string; topK?: number }): Promise<{ query: string; results: ChunkResult[] }>;
}
