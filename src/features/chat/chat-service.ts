import type { AnswerResult } from '../agent/answer-service.js'
import { AnswerService } from '../agent/answer-service.js'
import type { ChatMemoryPort } from '../../shared/contracts/chat-memory.js'
import type { ChatTurn } from '../../shared/types/chat.js'
import { AppError } from '../../shared/http/errors.js'

export type ChatRequest = {
  query: string
  traceId: string
  sessionId?: string | null
}

export type ChatResponse = {
  session_id: string
  traceId: string
  result: AnswerResult
}

export class ChatService {
  constructor(
    private readonly deps: {
      answer: AnswerService
      memory: ChatMemoryPort
    },
  ) {}

  async chat(input: ChatRequest): Promise<ChatResponse> {
    if (!input.query?.trim()) {
      throw new AppError('query is required', { code: 'bad_request', status: 400 })
    }
    if (!input.traceId?.trim()) {
      throw new AppError('traceId is required', { code: 'bad_request', status: 400 })
    }

    // Ensure session exists
    let session_id = input.sessionId?.trim() || null
    if (!session_id) {
      const created = await this.deps.memory.createChatSession({ traceId: input.traceId })
      session_id = created.id
    }

    // Load last 5 turns (10 messages max), map to turns for rewrite
    const history = await this.deps.memory.getChatHistory(session_id)
    const chatHistory: ChatTurn[] = history
      .slice()
      .reverse() // oldest-first
      .map((m) => ({ role: m.role, content: m.content }))

    // Generate answer using rewrite/retrieve/generate pipeline
    // NOTE: persistence is now handled inside AnswerService via upsertSession/appendSessionMessage RPCs.
    const result = await this.deps.answer.answer({
      query: input.query,
      traceId: input.traceId,
      sessionId: session_id,
      chatHistory,
    })

    return { session_id, traceId: input.traceId, result }
  }
}
