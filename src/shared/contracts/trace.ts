export type TraceEventType = 'ingest' | 'transform' | 'retrieve' | 'generate'

export type TraceLogInput = {
  traceId: string
  event_type: TraceEventType
  stage: string
  payload: Record<string, unknown>
}

export interface TracePort {
  logTrace(input: TraceLogInput): Promise<void>
}
