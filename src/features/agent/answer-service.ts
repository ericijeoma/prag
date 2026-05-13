import Groq from 'groq-sdk'
import type { SupabaseClient } from '@supabase/supabase-js'

import { SearchService, type SearchEnv } from '../retrieval/search-service.js'

export type AnswerEnv = SearchEnv & {
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
  private readonly search: SearchService
  private readonly groq: Groq

  constructor(
    private readonly deps: {
      supabase: SupabaseClient
      env: AnswerEnv
    },
  ) {
    this.search = new SearchService({ supabase: deps.supabase, env: deps.env })
    this.groq = new Groq({ apiKey: deps.env.GROQ_API_KEY })
  }

  async answer(input: AnswerRequest): Promise<AnswerResult> {
    if (!input.query?.trim()) throw new Error('query is required')

    const search = await this.search.search({ query: input.query, topK: 5 })
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
