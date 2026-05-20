import type { HistoryTurn } from '../lib/history';

export function SidebarHistory({
  turns,
  onClear,
}: {
  turns: HistoryTurn[];
  onClear: () => void;
}) {
  // Extract the first user message to serve as the Session Title
  const firstUserTurn = turns.find((t) => t.role === 'user');
  const chatTitle = firstUserTurn ? firstUserTurn.content : 'New Conversation';
  const messageCount = turns.length;

  return (
    <aside className="hidden h-full w-80 flex-col border-r border-slate-800 bg-slate-950 md:flex">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="text-sm font-semibold text-slate-200">Chat Sessions</div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 transition-colors"
        >
          Clear
        </button>
      </div>
      
      <div className="flex-1 overflow-auto p-3">
        {turns.length === 0 ? (
          <div className="text-sm text-slate-500 px-2">No active session.</div>
        ) : (
          <ul className="space-y-2">
            {/* Renders a single Session Card instead of multiple message cards */}
            <li className="cursor-pointer rounded-lg border border-sky-900/50 bg-sky-950/30 p-3 hover:bg-sky-900/50 transition-colors">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-sky-400">Current Session</span>
                <span className="text-[10px] font-medium text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full">
                  {messageCount} messages
                </span>
              </div>
              <div className="line-clamp-2 text-sm text-slate-300 leading-relaxed">
                {chatTitle || 'Uploaded Document Context'}
              </div>
            </li>
          </ul>
        )}
      </div>
    </aside>
  );
}