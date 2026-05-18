import { getSessionId } from '../lib/session';

export function TopBar({
  onNewSession,
}: {
  onNewSession: () => void;
}) {
  const sessionId = getSessionId();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">PRAG</div>
          <div className="text-[11px] text-slate-500">Production RAG • Cloudflare Worker API</div>
        </div>
        <div className="flex items-center gap-2">
          {sessionId ? (
            <span className="hidden rounded-md border border-slate-800 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300 md:inline">
              session_id: {sessionId.slice(0, 12)}…
            </span>
          ) : null}
          <button
            type="button"
            onClick={onNewSession}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
          >
            New session
          </button>
        </div>
      </div>
    </header>
  );
}
