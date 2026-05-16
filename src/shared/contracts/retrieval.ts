// This contract is the only thing the agent feature is
// allowed to know about retrieval. The concrete implementation
// lives in features/retrieval — never imported by agent directly.

export interface ChunkResult {
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  chunk_text: string;
  parent_text?: string | null;
  page_number?: number | null;
  is_child?: boolean;
  document_title?: string
  score: number;
}

export interface RetrievalPort {
  search(input: {
    query: string;
    topK?: number;
    traceId?: string;
    chatHistory?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  }): Promise<{ query: string; results: ChunkResult[] }>;
}
