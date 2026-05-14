import type { SupabaseClient } from '@supabase/supabase-js';

import { ChunkRepository } from '../../infrastructure/supabase/chunk-repository.js';
import { RecursiveChunker } from '../../shared/chunking/recursive-chunker.js';
import { AppError } from '../../shared/http/errors.js';
import type { AiBinding } from '../../shared/types/ai';

export type IngestEnv = {
	AI: AiBinding;
};

export type IngestRequest = {
	title: string;
	content: string;
	metadata?: Record<string, unknown>;
	file_path?: string | null;
	source_type?: string;
};

export type IngestResult = {
	documentId: string;
	chunksInserted: number;
};

const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';

export class IngestService {
	private readonly repo: ChunkRepository;
	private readonly chunker: RecursiveChunker;

	constructor(
		private readonly deps: {
			supabase: SupabaseClient;
			env: IngestEnv;
		},
	) {
		this.repo = new ChunkRepository(deps.supabase);
		this.chunker = new RecursiveChunker({ minTokens: 300, maxTokens: 800, overlapTokens: 100 });
	}

	async ingest(input: IngestRequest): Promise<IngestResult> {
		if (!input.title?.trim()) {
			throw new AppError('title is required', { code: 'bad_request', status: 400 });
		}
		if (!input.content?.trim()) {
			throw new AppError('content is required', { code: 'bad_request', status: 400 });
		}

		const { id: documentId } = await this.repo.insertDocument({
			title: input.title,
			content: input.content,
			metadata: input.metadata ?? {},
			file_path: input.file_path ?? null,
			source_type: input.source_type ?? 'upload',
		});

		const chunks = this.chunker.chunk(input.content);
		let inserted = 0;

		for (const chunk of chunks) {
			const { id: chunkId } = await this.repo.insertChunk({
				document_id: documentId,
				chunk_index: chunk.index,
				chunk_text: chunk.text,
				chunk_metadata: {
					...(input.metadata ?? {}),
					startChar: chunk.startChar,
					endChar: chunk.endChar,
				},
			});

			const embedding = await this.embedText(chunk.text);
			await this.repo.insertChunkVector({ chunk_id: chunkId, embedding });
			inserted++;
		}

		return { documentId, chunksInserted: inserted };
	}

	private async embedText(text: string): Promise<number[]> {
		const result = await this.deps.env.AI.run(EMBEDDING_MODEL, { text });

		// Workers AI embedding responses vary by runtime version. Normalize.
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
