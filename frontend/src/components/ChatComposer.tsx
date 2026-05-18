import { useEffect, useMemo, useRef, useState } from 'react';
import { ingestFile } from '../lib/ingest';
import { getSessionId } from '../lib/session';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

type UploadItem = {
  id: string;
  file: File;
  state: UploadState;
  traceId?: string;
  error?: string;
};

export function ChatComposer({
  disabled,
  onSend,
}: {
  disabled?: boolean;
  onSend: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const uploading = useMemo(() => uploads.some((u) => u.state === 'uploading'), [uploads]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function submit() {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    await onSend(msg);
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

    // Clear input to allow selecting same file again
    if (fileRef.current) fileRef.current.value = '';

    const session_id = getSessionId();

    await Promise.all(
      newItems.map(async (item) => {
        const result = await ingestFile(item.file, { session_id });
        setUploads((prev) =>
          prev.map((u) =>
            u.id !== item.id
              ? u
              : result.ok
                ? { ...u, state: 'success', traceId: result.traceId }
                : { ...u, state: 'error', traceId: result.traceId, error: result.message },
          ),
        );
      }),
    );
  }

  return (
    <div className="border-t border-slate-800 bg-slate-950 p-4">
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
          disabled={disabled || text.trim().length === 0}
          className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {uploads.length > 0 ? (
        <div className="mx-auto mt-2 max-w-4xl">
          <div className="flex flex-col gap-1">
            {uploads.slice(0, 6).map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1 text-[12px]"
              >
                <div className="min-w-0">
                  <div className="truncate text-slate-200">{u.file.name}</div>
                  {u.state === 'error' ? (
                    <div className="truncate text-rose-300/90">{u.error ?? 'Upload failed'}</div>
                  ) : u.traceId ? (
                    <div className="truncate font-mono text-slate-500">trace: {u.traceId}</div>
                  ) : null}
                </div>

                <div className="ml-3 flex items-center gap-2">
                  {u.state === 'uploading' ? (
                    <div className="flex items-center gap-2 text-slate-400">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-500 border-t-transparent" />
                      <span>Uploading…</span>
                    </div>
                  ) : u.state === 'success' ? (
                    <div className="text-emerald-300">✓</div>
                  ) : u.state === 'error' ? (
                    <div className="text-rose-300">✕</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mx-auto mt-2 max-w-4xl text-[11px] text-slate-500">
        Enter to send, Shift+Enter for newline. Use the paperclip to upload files for ingestion.
      </div>
    </div>
  );
}
