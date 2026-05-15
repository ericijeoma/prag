import { getGroqClient } from '../../shared/llm/groq-client.js';
import type { RetrievalPort } from '../../shared/contracts/retrieval.js';
import { AppError } from '../../shared/http/errors.js';

export type AnswerEnv = {
  GROQ_API_KEY: string;
};

export type AnswerRequest = {
  query: string;
};

export type Citation = {
  document_id: string;
  document_title: string;
  chunk_id: string;
  chunk_index: number;
  text: string;
  score: number;
};

export type AnswerResult = {
  answer: string;
  citations: Citation[];
};

const GROQ_MODEL = 'openai/gpt-oss-120b';

type GroqGlobal = typeof globalThis & {
  GROQ_API_KEY?: string;
};

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

function buildPrompt(query: string, citations: Citation[]): string {
  const context = citations
    .map(
      (c, idx) =>
        `[#${idx + 1}] source="${c.document_title}"\nchunk_id=${c.chunk_id}\nchunk_index=${c.chunk_index}\n${c.text}`,
    )
    .join('\n\n');

  return [
    'You are PRAG, a precise production RAG agent.',
    'Answer strictly from the provided context.',
    'If the answer is present in the context, extract it directly and do not refuse.',
    'Only say you need more information if the context truly lacks the answer.',
    'Use short bullet points when the answer is a list.',
    'Citations must be added at the end of relevant sentences like [#1].',
    '',
    'Context:',
    context || '(No context found)',
    '',
    `Question: ${query}`,
    'Answer:',
  ].join('\n');
}

export class AnswerService {
  private readonly retrieval: RetrievalPort;
  private readonly groq: ReturnType<typeof getGroqClient>;

  constructor(
    private readonly deps: {
      retrieval: RetrievalPort;
      env: AnswerEnv;
    },
  ) {
    this.retrieval = deps.retrieval;

    const groqGlobal = globalThis as GroqGlobal;
    groqGlobal.GROQ_API_KEY ??= deps.env.GROQ_API_KEY;

    this.groq = getGroqClient();
  }

  async answer(input: AnswerRequest): Promise<AnswerResult> {
    if (!input.query?.trim()) {
      throw new AppError('query is required', { code: 'bad_request', status: 400 });
    }

    const search = await this.retrieval.search({ query: input.query, topK: 5 });

    const citations: Citation[] = search.results.map((r) => ({
      document_id: r.document_id,
      document_title: r.document_title ?? 'Unknown Document',
      chunk_id: r.chunk_id,
      chunk_index: r.chunk_index,
      text: truncateText(r.chunk_text, 800),
      score: r.score,
    }));

    const prompt = buildPrompt(input.query, citations);

    const completion = await this.groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are a precise assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? '';

    return { answer, citations };
  }
}