import { getGroqClient } from '../../shared/llm/groq-client.js'
import type { RetrievalPort } from '../../shared/contracts/retrieval.js'
import { AppError } from '../../shared/http/errors.js'

export type AnswerEnv = {
  GROQ_API_KEY: string
}

export type AnswerRequest = {
  query: string
}

export type Citation = {
  document_id: string
  chunk_id: string
  chunk_index: number
  text: string
  score: number
}

export type AnswerResult = {
  answer: string
  citations: Citation[]
}

const GROQ_MODEL = 'openai/gpt-oss-120b'

function buildPrompt(query: string, citations: Citation[]): string {
  const context = citations
    .map(
      (c, idx) =>
        `[#${idx + 1}] document_id=${c.document_id} chunk_id=${c.chunk_id} chunk_index=${c.chunk_index}\n${c.text}`,
    )
    .join('\n\n')

  return [
    'You are PRAG, a production RAG agent.',
    'Answer the user question using ONLY the provided context.',
    'If the context is insufficient, say you do not know.',
    'When you use a fact from the context, add citations like [#1] at the end of the sentence.',
    '',
    'Context:',
    context || '(no context)',
    '',
    `Question: ${query}`,
    'Answer:',
  ].join('\n')
}

export class AnswerService {
  private readonly retrieval: RetrievalPort
  private readonly groq: ReturnType<typeof getGroqClient>

  constructor(
    private readonly deps: {
      retrieval: RetrievalPort
      env: AnswerEnv
    },
  ) {
    this.retrieval = deps.retrieval

    // Bridge Worker bindings (env) into the shared Groq adapter (global/process).
    // This keeps feature code provider-agnostic while preserving current runtime behavior.
    ;(globalThis as Record<string, unknown>).GROQ_API_KEY ??= deps.env.GROQ_API_KEY

    this.groq = getGroqClient()
  }

  async answer(input: AnswerRequest): Promise<AnswerResult> {
    if (!input.query?.trim()) {
      throw new AppError('query is required', { code: 'bad_request', status: 400 })
    }

    const search = await this.retrieval.search({ query: input.query, topK: 5 })
    const citations: Citation[] = search.results.map((r) => ({
      document_id: r.document_id,
      chunk_id: r.chunk_id,
      chunk_index: r.chunk_index,
      text: r.chunk_text,
      score: r.score,
    }))

    const prompt = buildPrompt(input.query, citations)

    const completion = await this.groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are a precise assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    })

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? ''
    return { answer, citations }
  }
}
