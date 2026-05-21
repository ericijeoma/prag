import type { ChatTurn } from '../types/chat.js';
import type { SimilarChunk } from '../../infrastructure/supabase/chunk-repository.js';

export type RetrievalRequest = {
  query: string;
  topK?: number;
  traceId?: string;
  chatHistory?: ChatTurn[];
  sessionId?: string | null;
  documentIds?: string[];
};

export type RetrievalResult = {
  query: string;
  results: SimilarChunk[];
};

export interface RetrievalPort {
  search(input: RetrievalRequest): Promise<RetrievalResult>;
}