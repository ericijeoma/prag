/**
 * Minimal Workers AI binding surface.
 *
 * Workers AI supports multiple model families with different input/output shapes.
 * We intentionally type `run()` to return `unknown` and provide local, explicit
 * runtime shape checks at each call site.
 */

export type AiChatRole = 'system' | 'user' | 'assistant'

export type AiChatMessage = {
  role: AiChatRole
  content: string
}

export type AiEmbeddingInputs = {
  text: string | string[]
}

export type AiChatInputs = {
  messages: AiChatMessage[]
  max_tokens?: number
  temperature?: number
}

export type AiRunInput = string | AiEmbeddingInputs | AiChatInputs | Record<string, unknown>

export type AiBinding = {
  run(model: string, inputs: AiRunInput): Promise<unknown>
}