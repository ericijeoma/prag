const SESSION_ID_KEY = 'session_id';

export function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_ID_KEY)?.trim();
  if (existing) return existing;

  // Use the browser's native API to generate a valid UUID v4
  const created = crypto.randomUUID(); 
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