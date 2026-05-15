import type { SupabaseClient } from '@supabase/supabase-js';

import { ChunkRepository, type SimilarChunk } from '../../infrastructure/supabase/chunk-repository.js';
import type { RetrievalPort } from '../../shared/contracts/retrieval.js';
import { AppError } from '../../shared/http/errors.js';
import type { AiBinding } from '../../shared/types/ai';

export type SearchEnv = {
	AI: AiBinding;
};

export type SearchRequest = {
	query: string;
	topK?: number;
};

export type SearchResult = {
	query: string;
	results: SimilarChunk[];
};

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';

export class SearchService {
	private readonly repo: ChunkRepository;

	constructor(
		private readonly deps: {
			supabase: SupabaseClient;
			env: SearchEnv;
		},
	) {
		this.repo = new ChunkRepository(deps.supabase);
	}

	async search(input: SearchRequest): Promise<SearchResult> {
		if (!input.query?.trim()) {
			throw new AppError('query is required', { code: 'bad_request', status: 400 });
		}
		const topK = input.topK ?? 5;
		const fetchK = Math.max(topK * 2, 10);

		const embedding = await this.embed(input.query);
		const rawResults = await this.repo.similaritySearch({
			embedding,
			topK: fetchK,
		});

		// Fix #1: Deduplicate (Document ID + Index)
		// Fix #5: Apply Score Threshold
		const uniqueMap = new Map<string, SimilarChunk>();
		for (const chunk of rawResults) {
			// Dedup by the actual content (first 100 chars is enough) instead of document ID.
			const key = chunk.chunk_text.slice(0, 100);
			if (!uniqueMap.has(key) && chunk.score > 0.55) {
				uniqueMap.set(key, chunk);
			}
		}

		const results = Array.from(uniqueMap.values()).slice(0, topK);
		return { query: input.query, results };
	}

	private async embed(text: string): Promise<number[]> {
		const result = await this.deps.env.AI.run(EMBEDDING_MODEL, { text });
		const vector =
			(result?.data?.[0] as number[] | undefined) ??
			(result?.data as number[] | undefined) ??
			(result?.embedding as number[] | undefined) ??
			(result?.result as number[] | undefined);

		if (!vector || !Array.isArray(vector)) {
			throw new AppError('Workers AI embedding returned an unexpected shape', {
				code: 'internal_error',
				status: 500,
				details: { resultShape: Object.keys(result ?? {}) },
			});
		}
		return vector;
	}
}

// This class satisfies the shared RetrievalPort contract.
// (The agent feature depends on the interface only, not this implementation.)
void (0 as unknown as SearchService satisfies RetrievalPort);
