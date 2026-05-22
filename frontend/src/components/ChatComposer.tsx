import { useEffect, useMemo, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import { createTraceId } from '../lib/trace';
import { getSessionId } from '../lib/session';

const INGEST_ENDPOINT = 'https://prag.ericijeoma7767.workers.dev/ingest';

export type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export type UploadItem = {
  id: string;
  file: File;
  state: UploadState;
  traceId?: string;
  error?: string;
  documentId?: string;
};

type IngestEnvelopeOk = {
  ok: true;
  queued?: boolean;
  document_id?: string;
  result?: {
    document_id?: string;
  };
};

type IngestEnvelopeErr = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type IngestEnvelope = IngestEnvelopeOk | IngestEnvelopeErr;

type UploadOutcome =
  | { ok: true; traceId: string; queued: boolean; documentId?: string }
  | { ok: false; traceId: string; message: string };

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v)),
    ),
  );
}

async function uploadFile(file: File, session_id?: string | null): Promise<UploadOutcome> {
  const traceId = createTraceId();

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
      message: 'POST /ingest',
      level: res.ok && envelope.ok ? 'info' : 'error',
      data: {
        filename: file.name,
        size: file.size,
        status: res.status,
        traceId,
      },
    });

    if (!res.ok || envelope.ok === false) {
      const message =
        envelope.ok === false
          ? (envelope.error?.message ?? 'Ingest failed')
          : 'Ingest failed';

      return { ok: false, traceId, message };
    }

    const documentId = envelope.document_id ?? envelope.result?.document_id;

    return {
      ok: true,
      traceId,
      queued: res.status === 202,
      documentId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    Sentry.captureException(err);
    return { ok: false, traceId, message };
  }
}

export function ChatComposer({
  disabled,
  onSend,
  onActiveDocumentIdsChange,
}: {
  disabled?: boolean;
  onSend: (text: string, attachments: UploadItem[]) => void | Promise<void>;
  onActiveDocumentIdsChange?: (documentIds: string[]) => void;
  resetSignal?: number;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const uploading = useMemo(() => uploads.some((u) => u.state === 'uploading'), [uploads]);

 const activeDocumentIds = useMemo(
    () =>
      uniqueStrings(
        uploads
          .filter((u) => u.state === 'success')
          .map((u) => u.documentId),
      ),
    [uploads],
  );

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    onActiveDocumentIdsChange?.(activeDocumentIds);
  }, [activeDocumentIds, onActiveDocumentIdsChange]);

 

  async function submit() {
    const msg = text.trim();
    const readyUploads = uploads.filter((u) => u.state === 'success');

    if (!msg && readyUploads.length === 0) return;

    setText('');
    await onSend(msg, readyUploads);
    setUploads((prev) => prev.filter((u) => u.state !== 'success'));
  }

  function makeId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selected = Array.from(files);
    const newItems: UploadItem[] = selected.map((file) => ({
      id: makeId('file'),
      file,
      state: 'uploading',
    }));

    setUploads((prev) => [...newItems, ...prev]);

    if (fileRef.current) fileRef.current.value = '';

    const session_id = getSessionId();

    await Promise.all(
      newItems.map(async (item) => {
        const result = await uploadFile(item.file, session_id);

        setUploads((prev) =>
          prev.map((u) =>
            u.id !== item.id
              ? u
              : result.ok
                ? {
                    ...u,
                    state: 'success',
                    traceId: result.traceId,
                    documentId: result.documentId,
                  }
                : {
                    ...u,
                    state: 'error',
                    traceId: result.traceId,
                    error: result.message,
                  },
          ),
        );
        if (!result.ok) {
          setTimeout(() => {
            setUploads((prev) => prev.filter((u) => u.id !== item.id));
          }, 4000);
        }
      }),
    );
  }

  return (
    <div className="border-t border-slate-800 bg-slate-950 p-4">

      {/* Successful / in-progress uploads sit ABOVE the input row */}
      {uploads.some((u) => u.state === 'success' || u.state === 'uploading') && (
        <div className="mx-auto mb-2 max-w-4xl">
          <div className="flex flex-col gap-1">
            {uploads
              .filter((u) => u.state === 'success' || u.state === 'uploading')
              .slice(0, 6)
              .map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-slate-200">{u.file.name}</div>
                    {u.traceId ? (
                      <div className="truncate font-mono text-slate-500">trace: {u.traceId}</div>
                    ) : null}
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    {u.state === 'uploading' ? (
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-500 border-t-transparent" />
                        <span>Uploading…</span>
                      </div>
                    ) : (
                      <div className="text-emerald-300">✓</div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="mx-auto flex max-w-4xl items-end gap-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />

        <button
          type="button"
          title="Upload files"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          className="grid h-10 w-10 place-items-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="text-lg leading-none">📎</span>
        </button>

        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          name="ask-prag"
          placeholder="Ask PRAG…"
          rows={2}
          className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-600"
          disabled={disabled}
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled || (text.trim().length === 0 && uploads.filter((u) => u.state === 'success').length === 0)}
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {/* Failed uploads sit BELOW the input row and auto-vanish after 4s */}
      {uploads.some((u) => u.state === 'error') && (
        <div className="mx-auto mt-2 max-w-4xl">
          <div className="flex flex-col gap-1">
            {uploads
              .filter((u) => u.state === 'error')
              .slice(0, 6)
              .map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-slate-200">{u.file.name}</div>
                    <div className="truncate text-rose-300/90">{u.error ?? 'Upload failed'}</div>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <div className="text-rose-300">✕</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="mx-auto mt-2 max-w-4xl text-[11px] text-slate-500">
        Enter to send, Shift+Enter for newline. Use the paperclip to upload files for ingestion.
      </div>
    </div>
  );
}