import type { SupabaseClient } from '@supabase/supabase-js';
import { TENANT_ID } from '../../shared/config/constants.js';
import { AppError } from '../../shared/http/errors.js';
import type { TracePort } from '../../shared/contracts/trace.js';
import type { ChatMemoryPort } from '../../shared/contracts/chat-memory.js';
import type { StoredChatMessage, StoredCitation } from '../../shared/types/chat.js';

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
  parent_text?: string | null;
  page_number?: number | null;
  is_child?: boolean;
};

export type ChunkVectorInsert = {
  chunk_id: string;
  embedding: number[];
};

export type TraceInsert = {
  traceId: string;
  stage: string;
  event_type: 'ingest' | 'transform' | 'retrieve' | 'generate';
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
  parent_text?: string | null;
  page_number?: number | null;
  is_child?: boolean;
  score: number;
};

export type ChatSessionRow = {
  id: string;
  created_at: string;
};

export type ChatMessageRow = StoredChatMessage;

function sanitizeDbText(text: string): string {
  const normalized = text.normalize('NFKC');
  let cleaned = '';

  for (const ch of normalized) {
    const code = ch.charCodeAt(0);
    if (ch === '\n' || ch === '\t' || code >= 32) {
      cleaned += ch;
    }
  }

  return cleaned;
}

function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeDbText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, sanitizeDeep(val)]),
    );
  }
  return value;
}

// function getSessionIdFromChunkMetadata(metadata: Record<string, unknown>): string | null {
//   const raw = metadata.session_id ?? metadata.sessionId ?? metadata.session;
//   return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
// }

export class ChunkRepository implements TracePort, ChatMemoryPort {
  constructor(private readonly supabase: SupabaseClient) {}

  async startIngestionJob(input: {
    traceId: string;
    sourceType: string;
    title: string;
    pageCount?: number | null;
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_start_ingestion_job', {
      p_tenant_id: TENANT_ID,
      p_trace_id: input.traceId,
      p_source_type: input.sourceType,
      p_title: input.title,
      p_page_count: input.pageCount ?? null,
    });

    if (error) {
      throw new AppError('Failed to start ingestion job', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      });
    }

    return { id: String(data) };
  }

  async completeIngestionJob(input: {
    traceId: string;
    chunkCount: number;
    pageCount?: number | null;
  }): Promise<void> {
    const { error } = await this.supabase.schema('public').rpc('prag_finish_ingestion_job', {
      p_trace_id: input.traceId,
      p_chunk_count: input.chunkCount,
      p_page_count: input.pageCount ?? null,
    });

    if (error) {
      throw new AppError('Failed to complete ingestion job', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      });
    }
  }

  async failIngestionJob(input: { traceId: string; errorMessage: string }): Promise<void> {
    const { error } = await this.supabase.schema('public').rpc('prag_fail_ingestion_job', {
      p_trace_id: input.traceId,
      p_error_message: input.errorMessage,
    });

    if (error) {
      throw new AppError('Failed to fail ingestion job', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      });
    }
  }

  async upsertSession(input: {
    sessionKey: string;
    summary?: string | null;
    state?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_upsert_session', {
      p_tenant_id: TENANT_ID,
      p_session_key: input.sessionKey,
      p_summary: input.summary ?? null,
      p_state: input.state ?? {},
    });

    if (error) {
      throw new AppError('Failed to upsert session', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      });
    }

    return { id: String(data) };
  }

  async appendSessionMessage(input: {
    sessionKey: string;
    role: 'user' | 'assistant';
    content: string;
    queryRewrite?: string | null;
    retrievedChunkIds?: string[];
    citationMap?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_append_session_message', {
      p_session_key: input.sessionKey,
      p_role: input.role,
      p_content: sanitizeDbText(input.content),
      p_query_rewrite: input.queryRewrite ?? null,
      p_retrieved_chunk_ids: input.retrievedChunkIds ?? [],
      p_citation_map: input.citationMap ?? {},
    });

    if (error) {
      throw new AppError('Failed to append session message', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      });
    }

    return { id: String(data) };
  }

  async logTrace(input: TraceInsert): Promise<void> {
    const { error } = await this.supabase.schema('public').rpc('prag_log_trace', {
      p_tenant_id: TENANT_ID,
      p_trace_id: input.traceId,
      p_event_type: input.event_type,
      p_stage: input.stage,
      p_payload: sanitizeDeep(input.payload),
    });

    if (error) {
      throw new AppError('Trace failed', { code: 'supabase_error', status: 500 });
    }
  }

  async createChatSession(input: { traceId: string }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_create_chat_session', {
      p_tenant_id: TENANT_ID,
      p_trace_id: input.traceId,
    });

    if (error) {
      throw new AppError('Chat session create failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }

    return { id: String(data) };
  }

  async storeChatMessage(input: {
    session_id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    trace_id: string;
    citations: StoredCitation[];
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_store_chat_message', {
      p_tenant_id: TENANT_ID,
      p_session_id: input.session_id,
      p_role: input.role,
      p_content: sanitizeDbText(input.content),
      p_trace_id: input.trace_id,
      p_citations: sanitizeDeep(input.citations),
    });

    if (error) {
      throw new AppError('Chat message store failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }

    return { id: String(data) };
  }

  async getChatHistory(sessionId: string): Promise<ChatMessageRow[]> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_get_chat_history', {
      p_tenant_id: TENANT_ID,
      p_session_id: sessionId,
      p_limit: 10,
    });

    if (error) {
      throw new AppError('Chat history fetch failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      session_id: String(row.session_id),
      role: row.role === 'system' || row.role === 'assistant' ? row.role : 'user',
      content: String(row.content ?? ''),
      trace_id: String(row.trace_id ?? ''),
      citations: Array.isArray(row.citations) ? (row.citations as Array<Record<string, unknown>>) : [],
      created_at: String(row.created_at),
    })) as StoredChatMessage[];
  }

  async insertDocument(input: DocumentInsert): Promise<{ id: string }> {
    const { data, error } = await this.supabase.schema('public').rpc('prag_insert_document', {
      p_tenant_id: TENANT_ID,
      p_title: sanitizeDbText(input.title),
      p_content: sanitizeDbText(input.content),
      p_metadata: sanitizeDeep(input.metadata ?? {}),
      p_file_path: input.file_path ? sanitizeDbText(input.file_path) : null,
      p_source_type: input.source_type ?? 'upload',
    });

    if (error) {
      console.error('Supabase Error Details:', error);
      throw new AppError('Doc insert failed', {
        code: 'supabase_error',
        status: 500,
        details: {
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
      });
    }

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
        })),
      );

    if (error) {
      throw new AppError('Batch vector insert failed', {
        code: 'supabase_error',
        status: 500,
        details: error,
      });
    }
  }

  async insertChunk(input: ChunkInsert): Promise<{ id: string }> {
    const results = await this.batchInsertChunks([input]);
    return { id: results[0].id };
  }

  async insertChunkVector(input: ChunkVectorInsert): Promise<{ id: string }> {
    await this.batchInsertVectors([input]);
    return { id: input.chunk_id };
  }

 async similaritySearch(input: {
  embedding: number[];
  topK?: number;
  sessionId?: string | null;
  documentIds?: string[];
}): Promise<SimilarChunk[]> {
  const { data, error } = await this.supabase.rpc('prag_match_chunks', {
    p_tenant_id: TENANT_ID,
    p_query_embedding: input.embedding,
    p_match_count: input.topK ?? 5,
  });

  if (error) {
    throw new AppError('Search failed', { code: 'supabase_error', status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const allowedDocumentIds = input.documentIds?.length ? new Set(input.documentIds) : null;
  const sessionId = input.sessionId?.trim() || null;

  const mapped = rows.map((row) => ({
    chunk_id: String(row.chunk_id),
    document_id: String(row.document_id),
    document_title: String(row.document_title ?? 'Unknown'),
    chunk_index: Number(row.chunk_index),
    chunk_text: String(row.chunk_text),
    chunk_metadata: (row.chunk_metadata as Record<string, unknown>) ?? {},
    parent_chunk_id: row.parent_chunk_id ? String(row.parent_chunk_id) : null,
    parent_text: typeof row.parent_text === 'string' ? row.parent_text : null,
    page_number: typeof row.page_number === 'number' ? row.page_number : null,
    is_child: typeof row.is_child === 'boolean' ? row.is_child : undefined,
    score: Number(row.score),
  }));

  const byDocument = allowedDocumentIds
    ? mapped.filter((row) => allowedDocumentIds.has(row.document_id))
    : mapped;

  if (!sessionId) {
    return byDocument;
  }

  const bySession = byDocument.filter((row) => {
    const raw = row.chunk_metadata.session_id ?? row.chunk_metadata.sessionId ?? row.chunk_metadata.session;
    return typeof raw === 'string' && raw.trim() === sessionId;
  });

  return bySession.length > 0 ? bySession : byDocument;
}
}