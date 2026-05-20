import type { AnswerResult } from '../lib/contracts';
import { linkifyCitationMarkers } from '../lib/citations';
import { isNoEvidence } from '../lib/no-evidence';
import { AnswerStatusBanner, type AnswerStatus } from './AnswerStatusBanner';
import { CitationBadges } from './CitationBadges';
import { MarkdownAnswer } from './MarkdownAnswer';

// UPDATE: Add attachments to the user message model
export type ChatMessageModel =
  | { id: string; role: 'user'; content: string; createdAt: number; attachments?: { id: string; name: string }[] }
  | { id: string; role: 'assistant'; result: AnswerResult; createdAt: number };

function resolveStatus(result: AnswerResult): AnswerStatus {
  if (isNoEvidence(result)) return { kind: 'no-evidence' };
  if (result.verified === true) return { kind: 'verified' };
  return { kind: 'unverified' };
}

export function ChatMessage({ msg }: { msg: ChatMessageModel }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75ch] flex flex-col gap-2 items-end">
          
          {/* UPDATE: Render uploaded files inside the chat stream */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {msg.attachments.map((file) => (
                <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-slate-700">
                  <span>📄</span>
                  <span className="max-w-[150px] truncate">{file.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Only render text bubble if they actually typed a message */}
          {msg.content && (
            <div className="rounded-2xl bg-sky-950/40 px-4 py-3 text-sm text-slate-100 ring-1 ring-sky-900/50">
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          )}

        </div>
      </div>
    );
  }

  const citations = msg.result.citations ?? [];
  const markdown = linkifyCitationMarkers(msg.result.answer ?? '');
  const status = resolveStatus(msg.result);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85ch] rounded-2xl bg-slate-900/40 px-4 py-3 ring-1 ring-slate-800">
        <div className="mb-3">
          <AnswerStatusBanner status={status} />
        </div>

        <MarkdownAnswer markdown={markdown || msg.result.answer || ''} citations={citations} />

        <CitationBadges citations={citations} />

        <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
          {msg.result.traceId ? (
            <span className="font-mono">trace: {msg.result.traceId}</span>
          ) : null}
          {msg.result.session_id ? (
            <span className="font-mono">session: {msg.result.session_id.slice(0, 8)}…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}