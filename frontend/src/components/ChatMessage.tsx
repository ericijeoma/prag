import type { AnswerResult } from '../lib/contracts';
import { extractCitationMatches, stripCitationMarkers } from '../lib/citations';
import { isNoEvidence } from '../lib/no-evidence';
import { AnswerStatusBanner, type AnswerStatus } from './AnswerStatusBanner';
import { CitationBadges } from './CitationBadges';
import { MarkdownAnswer } from './MarkdownAnswer';

export type ChatMessageModel =
  | { id: string; role: 'user'; content: string; createdAt: number }
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
        <div className="max-w-[75ch] rounded-2xl bg-sky-950/40 px-4 py-3 text-sm text-slate-100 ring-1 ring-sky-900/50">
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
      </div>
    );
  }

  const citations = msg.result.citations ?? [];
  const matches = extractCitationMatches(msg.result.answer ?? '', citations);
  const cleaned = stripCitationMarkers(msg.result.answer ?? '');
  const status = resolveStatus(msg.result);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85ch] rounded-2xl bg-slate-900/40 px-4 py-3 ring-1 ring-slate-800">
        <div className="mb-3">
          <AnswerStatusBanner status={status} />
        </div>

        <MarkdownAnswer markdown={cleaned || msg.result.answer || ''} />

        {/* (Optional) show detected citation markers */}
        {matches.length > 0 ? (
          <div className="mt-3 text-[11px] text-slate-500">
            Inline markers: {matches.map((m) => m.chunkId.slice(0, 8)).join(', ')}
          </div>
        ) : null}

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
