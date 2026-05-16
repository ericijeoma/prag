export type ChatRole = 'system' | 'user' | 'assistant'

export type StoredCitation = {
  document_id: string
  document_title: string
  chunk_id: string
  chunk_index: number
  page_number?: number | null
  score: number
}

export type StoredChatMessage = {
  id: string
  session_id: string
  role: ChatRole
  content: string
  trace_id: string
  citations: StoredCitation[]
  created_at: string
}

export type ChatTurn = {
  role: ChatRole
  content: string
}
