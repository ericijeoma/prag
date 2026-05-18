import type { HistoryTurn } from '../lib/history';

export function SidebarHistory({
  turns,
  onClear,
}: {
  turns: HistoryTurn[];
  onClear: () => void;
}) {
  return (
    <aside className="hidden h-full w-80 flex-col border-r border-slate-800 bg-slate-950 md:flex">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="text-sm font-semibold text-slate-200">History</div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {turns.length === 0 ? (
          <div className="text-sm text-slate-500">No turns yet.</div>
        ) : (
          <ul className="space-y-2">
            {turns
              .slice()
              .reverse()
              .map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 p-2"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={
                        t.role === 'user'
                          ? 'text-xs font-semibold text-sky-300'
                          : 'text-xs font-semibold text-emerald-300'
                      }
                    >
                      {t.role}
                    </span>
                    <span className="text-[11px] text-slate-600">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="line-clamp-3 whitespace-pre-wrap text-xs text-slate-300">
                    {t.content}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
