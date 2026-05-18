export type HistoryTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
};

const HISTORY_KEY = 'chat_history';

export function loadHistory(): HistoryTurn[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryTurn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(turns: HistoryTurn[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.slice(-200)));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
