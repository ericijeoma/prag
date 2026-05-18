const SESSION_ID_KEY = 'session_id';

export function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_ID_KEY)?.trim();
  if (existing) return existing;

  const created = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(SESSION_ID_KEY, created);
  return created;
}

export function syncSessionIdFromServer(sessionId: string | undefined | null): void {
  const v = sessionId?.trim();
  if (!v) return;
  localStorage.setItem(SESSION_ID_KEY, v);
}

export function getSessionId(): string | null {
  const v = localStorage.getItem(SESSION_ID_KEY)?.trim();
  return v || null;
}

export function setSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_ID_KEY, sessionId);
}

export function clearSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY);
}
