import type { ChatRole, StoredCitation, StoredChatMessage } from '../types/chat.js'

export type CreateChatSessionInput = {
  traceId: string
}

export type StoreChatMessageInput = {
  session_id: string
  role: ChatRole
  content: string
  trace_id: string
  citations: StoredCitation[]
}

export interface ChatMemoryPort {
  createChatSession(input: CreateChatSessionInput): Promise<{ id: string }>
  storeChatMessage(input: StoreChatMessageInput): Promise<{ id: string }>
  getChatHistory(sessionId: string): Promise<StoredChatMessage[]>
}
