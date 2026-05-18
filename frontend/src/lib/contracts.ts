// Minimal frontend-side mirror of the Worker JSON contract.
// Keep this file aligned with backend AnswerResult contract shape.

export type Citation = {
  // backend: chunk_id + score are stable
  chunk_id: string;
  score?: number;
  // backend naming
  document_title?: string;
  document_id?: string;
  page_number?: number | null;
  source_label?: string;
  // legacy/compat
  title?: string;
  similarity?: number;
  url?: string;
};

export type AnswerResult = {
  answer: string;
  verified?: boolean;
  degraded?: boolean;
  traceId?: string;
  citations?: Citation[];
  session_id?: string;
};

export type ChatRequest = {
  // backend expects `query` + optional `session_id`
  query: string;
  session_id?: string;
};
