import { getGroqClient } from '../../shared/llm/groq-client.js';
import type { RetrievalPort } from '../../shared/contracts/retrieval.js';
import { AppError } from '../../shared/http/errors.js';
import type { ChatTurn } from '../../shared/types/chat.js';
import { ChunkRepository } from '../../infrastructure/supabase/chunk-repository.js';

export type AnswerEnv = {
	GROQ_API_KEY: string;
	AI?: import('../../shared/types/ai.js').AiBinding;
};

export type AnswerRequest = {
	query: string;
	traceId?: string;
	sessionId?: string;
	chatHistory?: ChatTurn[];
};

export type Citation = {
	document_id: string;
	document_title: string;
	chunk_id: string;
	chunk_index: number;
	page_number?: number | null;
	text: string;
	score: number;
	source_label?: string;
};

export type AnswerResult = {
	answer: string;
	citations: Citation[];
	verified: boolean;
	degraded: boolean;
};

const GROQ_MODEL = 'openai/gpt-oss-120b';

const FAITHFULNESS_MODEL = '@cf/meta/llama-3-8b-instruct';
// const MIN_RETRIEVAL_SCORE_FOR_ANSWER = 0.45;

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
    .map((c, index) => {
      const page = typeof c.page_number === 'number' ? c.page_number : 'N/A';
      // Append the actual text content right below the metadata header
      return [
        `${c.source_label ?? `C${index + 1}`} | Page=${page} | Title="${c.document_title}"`,
        c.text
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    'You are PRAG, a production RAG agent.',
    'You MUST answer ONLY using the context below.',
    'If the context does not contain the needed information, say: "I don\'t have enough specific information to answer that."',
    '',
    'Citation rules (mandatory):',
    '- Use only the labels [C1], [C2], ... that are provided in the context',
    '- Do not invent sources, page numbers, or chunk IDs',
    '- Every factual sentence must end with one or more labels',
    '- Use one or more citations per sentence when needed.',
    '- Do not invent sources/pages. If page is unknown, use Page: N/A.',
    '',
    'Context:',
    context || '(No context found)',
    '',
    `Question: ${query}`,
    'Answer:',
  ].join('\n');
}

function buildFaithfulnessPrompt(args: { answer: string; context: string }): string {
	return [
		'You are a strict fact-checking component for RAG.',
		'Given an ANSWER and the CONTEXT, determine if every non-trivial claim in the answer is supported by the context.',
		'Output JSON only with the following schema:',
		'{"verdict":"supported"|"unsupported","unsupported_claims":["..."]}',
		'',
		'CONTEXT:',
		args.context,
		'',
		'ANSWER:',
		args.answer,
	].join('\n');
}

function renderCitation(c: Citation): string {
	const page = typeof c.page_number === 'number' ? c.page_number : 'N/A';
	return `[Source: ${c.document_title}, Page: ${page}]`;
}

function renderAnswer(answer: string, citations: Citation[]): string {
	let output = answer;
	for (const c of citations) {
		if (!c.source_label) continue;
		output = output.split(`[${c.source_label}]`).join(renderCitation(c));
	}
	return output;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	const slice = text.slice(start, end + 1);
	try {
		const parsed: unknown = JSON.parse(slice);
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

export class AnswerService {
	private readonly retrieval: RetrievalPort;
	private readonly groq: ReturnType<typeof getGroqClient>;
	private readonly repo: ChunkRepository;

	constructor(
		private readonly deps: {
			retrieval: RetrievalPort;
			repo: ChunkRepository;
			env: AnswerEnv;
		},
	) {
		this.retrieval = deps.retrieval;
		this.repo = deps.repo;

		const groqGlobal = globalThis as GroqGlobal;
		groqGlobal.GROQ_API_KEY ??= deps.env.GROQ_API_KEY;

		this.groq = getGroqClient();
	}

	async answer(input: AnswerRequest): Promise<AnswerResult> {
		if (!input.query?.trim()) {
			throw new AppError('query is required', { code: 'bad_request', status: 400 });
		}

		const search = await this.retrieval.search({
			query: input.query,
			topK: 5,
			// If retrieval implementation supports it, pass history for rewrite.
			chatHistory: input.chatHistory,
			traceId: input.traceId,
		});

		const rewrittenQuery = search.query;
		const sessionKey = input.sessionId ?? input.traceId ?? 'default';

		await this.repo.upsertSession({
			sessionKey,
			state: {},
		});

		await this.repo.appendSessionMessage({
			sessionKey,
			role: 'user',
			content: input.query,
			queryRewrite: rewrittenQuery ?? null,
			retrievedChunkIds: search.results.map((r) => r.chunk_id),
			citationMap: {},
		});

		// const bestScore = search.results[0]?.score ?? 0;
		const hasEvidence = search.results.length > 0;

		if (!hasEvidence) {
			const answer = "I don't have enough specific information to answer that.";

			await this.repo.appendSessionMessage({
				sessionKey,
				role: 'assistant',
				content: answer,
				queryRewrite: rewrittenQuery ?? null,
				retrievedChunkIds: search.results.map((r) => r.chunk_id),
				citationMap: {},
			});

			return {
				answer,
				citations: [],
				verified: true,
				degraded: true,
			};
		}

		// Provide parent_text to the LLM for generation; fallback to chunk_text.
		const citations: Citation[] = search.results.map((r, idx) => ({
			document_id: r.document_id,
			document_title: r.document_title ?? 'Unknown Document',
			chunk_id: r.chunk_id,
			chunk_index: r.chunk_index,
			page_number: r.page_number ?? null,
			text: truncateText(r.parent_text ?? r.chunk_text, 1600),
			score: r.score,
			source_label: `C${idx + 1}`,
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

		const rawAnswer = completion.choices?.[0]?.message?.content?.trim() ?? '';
		const answer = renderAnswer(rawAnswer, citations);

		const verified = await this.verifyFaithfulness({
			answer,
			citations,
		});

		await this.repo.appendSessionMessage({
			sessionKey,
			role: 'assistant',
			content: answer,
			queryRewrite: rewrittenQuery ?? null,
			retrievedChunkIds: search.results.map((r) => r.chunk_id),
			citationMap: Object.fromEntries(
				citations.map((c, index) => [
					`C${index + 1}`,
					{
						document_id: c.document_id,
						document_title: c.document_title,
						chunk_id: c.chunk_id,
						page_number: c.page_number ?? null,
					},
				]),
			),
		});

		return { answer, citations, verified, degraded: !verified };
	}

	private async verifyFaithfulness(input: { answer: string; citations: Citation[] }): Promise<boolean> {
		// If Workers AI isn't configured, skip verification (still type-safe).
		if (!this.deps.env.AI) return false;

		const context = input.citations.map((c) => c.text).join('\n\n---\n\n');
		const prompt = buildFaithfulnessPrompt({ answer: input.answer, context });

		const result: unknown = await this.deps.env.AI.run(FAITHFULNESS_MODEL, {
			messages: [
				{ role: 'system', content: 'Return JSON only.' },
				{ role: 'user', content: prompt },
			],
			temperature: 0,
			max_tokens: 256,
		});

		const text = this.extractText(result);
		const json = text ? extractJsonObject(text) : null;
		const verdict = json?.verdict;
		if (verdict === 'supported') {
			return true;
		}

		const unsupportedClaims = Array.isArray(json?.unsupported_claims) ? json.unsupported_claims : [];

		// Allow minor paraphrasing differences.
		// Fail only when verifier identifies multiple unsupported claims.
		return unsupportedClaims.length <= 1;
	}

	private extractText(result: unknown): string | null {
		if (typeof result === 'string') return result;
		if (typeof result === 'object' && result !== null) {
			const rec = result as Record<string, unknown>;
			if (typeof rec.response === 'string') return rec.response;
			if (typeof rec.result === 'object' && rec.result !== null) {
				const inner = rec.result as Record<string, unknown>;
				if (typeof inner.response === 'string') return inner.response;
			}
			const choices = rec.choices;
			if (Array.isArray(choices) && choices.length > 0) {
				const first = choices[0];
				if (typeof first === 'object' && first !== null) {
					const c = first as Record<string, unknown>;
					const msg = c.message;
					if (typeof msg === 'object' && msg !== null) {
						const m = msg as Record<string, unknown>;
						if (typeof m.content === 'string') return m.content;
					}
				}
			}
		}
		return null;
	}
}
