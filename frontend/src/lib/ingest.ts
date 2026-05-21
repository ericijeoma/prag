import * as Sentry from '@sentry/react';
import { createTraceId } from './trace';

const INGEST_ENDPOINT = 'https://prag.ericijeoma7767.workers.dev/ingest';

// Added document_id to the success envelope
type IngestEnvelopeOk = { ok: true; result?: unknown; queued?: boolean; document_id?: string };
type IngestEnvelopeErr = { ok: false; error?: { code?: string; message?: string; details?: unknown } };
type IngestEnvelope = IngestEnvelopeOk | IngestEnvelopeErr;

export type IngestOutcome =
  | { ok: true; traceId: string; queued: boolean; documentId?: string }
  | { ok: false; traceId: string; message: string };

export async function ingestFile(
  file: File,
  input: { session_id?: string | null } = {},
): Promise<IngestOutcome> {
  const traceId = createTraceId();
  const session_id = input.session_id ?? undefined;

  try {
    const metadata = JSON.stringify({
      uploaded_from: 'frontend',
      filename: file.name,
      mime: file.type,
      size: file.size,
    });

    const res = await fetch(INGEST_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-trace-id': traceId,
        ...(session_id ? { 'x-session-id': session_id } : {}),
        'x-file-name': encodeURIComponent(file.name),
        'x-file-metadata': encodeURIComponent(metadata),
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    let envelope: IngestEnvelope;
    try {
      envelope = (await res.json()) as IngestEnvelope;
    } catch {
      envelope = { ok: false, error: { message: 'Invalid JSON response from server.' } };
    }

    Sentry.addBreadcrumb({
      category: 'fetch',
      message: 'POST /ingest (Binary Stream)',
      level: res.ok && envelope.ok ? 'info' : 'error',
      data: { filename: file.name, size: file.size, status: res.status },
    });

    if (!res.ok || envelope.ok === false) {
      const message = envelope.ok === false ? (envelope.error?.message ?? 'Ingest failed') : 'Ingest failed';
      return { ok: false, traceId, message };
    }

    // Explicitly extract document_id from the successful envelope
    return { 
      ok: true, 
      traceId, 
      queued: res.status === 202,
      documentId: 'document_id' in envelope ? envelope.document_id : undefined 
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    Sentry.captureException(err);
    return { ok: false, traceId, message };
  }
}