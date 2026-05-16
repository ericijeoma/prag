import { AppError } from '../http/errors.js'

export function createTraceId(): string {
  // Prefer crypto.randomUUID when available.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    const c = crypto as unknown as { randomUUID?: () => string }
    if (typeof c.randomUUID === 'function') return c.randomUUID()
  }

  // Fallback — still unique enough for local/dev.
  return `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function resolveTraceId(headers: Headers): string {
  const fromHeader = headers.get('x-trace-id')?.trim()
  if (fromHeader) return fromHeader

  return createTraceId()
}

export function resolveSessionId(headers: Headers): string | null {
  const sessionId = headers.get('x-session-id')?.trim()
  return sessionId || null
}

export function assertNonEmpty(value: string | null | undefined, label: string): string {
  if (!value?.trim()) {
    throw new AppError(`${label} is required`, { code: 'bad_request', status: 400 })
  }
  return value
}
