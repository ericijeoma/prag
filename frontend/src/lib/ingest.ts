import * as Sentry from '@sentry/react';
import { createTraceId } from './trace';

const INGEST_ENDPOINT = 'https://prag.ericijeoma7767.workers.dev/ingest';

type IngestEnvelopeOk = { ok: true; result?: unknown };
type IngestEnvelopeErr = { ok: false; error?: { code?: string; message?: string; details?: unknown } };
type IngestEnvelope = IngestEnvelopeOk | IngestEnvelopeErr;

export type IngestOutcome =
  | { ok: true; traceId: string }
  | { ok: false; traceId: string; message: string };

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

async function readFileText(file: File): Promise<string> {
  // Requirement: standard Web FileReader API
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

async function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  // Requirement: standard Web FileReader API
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function ingestFile(file: File, input: { session_id?: string | null } = {}): Promise<IngestOutcome> {
  const traceId = createTraceId();
  const session_id = input.session_id ?? undefined;

  try {
    let res: Response;

    if (isPdf(file)) {
      // Backend supports multipart + does its own PDF text extraction.
      // Still read via FileReader (per requirement) to validate we can access the bytes client-side.
      await readFileArrayBuffer(file);

      const form = new FormData();
      form.set('file', file);
      form.set('title', file.name);
      form.set('metadata', JSON.stringify({ uploaded_from: 'frontend', filename: file.name, mime: file.type }));

      res = await fetch(INGEST_ENDPOINT, {
        method: 'POST',
        headers: {
          'x-trace-id': traceId,
          ...(session_id ? { 'x-session-id': session_id } : {}),
        },
        body: form,
      });
    } else {
      // Backend expects: { title, content, metadata?, file_path?, source_type? }
      const content = await readFileText(file);
      const payload = {
        title: file.name,
        content,
        metadata: { uploaded_from: 'frontend', filename: file.name, mime: file.type, size: file.size },
        file_path: file.name,
        source_type: 'text',
      };

      res = await fetch(INGEST_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': traceId,
          ...(session_id ? { 'x-session-id': session_id } : {}),
        },
        body: JSON.stringify(payload),
      });
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = { ok: false, error: { message: 'Invalid JSON response from server.' } };
    }

    const env = json as IngestEnvelope;

    Sentry.addBreadcrumb({
      category: 'fetch',
      message: 'POST /ingest',
      level: res.ok && env.ok ? 'info' : 'error',
      data: {
        filename: file.name,
        size: file.size,
        mime: file.type,
        ok: res.ok,
        status: res.status,
        traceId,
        session_id,
      },
    });

    if (!res.ok || env.ok === false) {
      const message = env.ok === false ? env.error?.message ?? 'Ingest failed' : 'Ingest failed';
      Sentry.captureException(new Error(message), {
        extra: { response: env, status: res.status, traceId, filename: file.name },
      });
      return { ok: false, traceId, message };
    }

    return { ok: true, traceId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingest failed';
    Sentry.captureException(err, { extra: { traceId, filename: file.name } });
    return { ok: false, traceId, message };
  }
}
