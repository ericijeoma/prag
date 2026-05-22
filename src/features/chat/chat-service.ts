import type { AnswerResult } from '../agent/answer-service.js';
import { AnswerService } from '../agent/answer-service.js';
import type { ChatMemoryPort } from '../../shared/contracts/chat-memory.js';
import type { ChatTurn } from '../../shared/types/chat.js';
import { AppError } from '../../shared/http/errors.js';

type StoredChatMessage = {
	role: ChatTurn['role'];
	content: string;
};

export type ChatRequest = {
	query: string;
	traceId: string;
	sessionId?: string | null;
	documentIds?: string[];
};

export type ChatResponse = {
	session_id: string;
	traceId: string;
	result: AnswerResult;
};

export class ChatService {
	constructor(
		private readonly deps: {
			answer: AnswerService;
			memory: ChatMemoryPort;
		},
	) {}

	async chat(input: ChatRequest): Promise<ChatResponse> {
		if (!input.query?.trim()) {
			throw new AppError('query is required', { code: 'bad_request', status: 400 });
		}

		if (!input.traceId?.trim()) {
			throw new AppError('traceId is required', { code: 'bad_request', status: 400 });
		}

		let session_id = input.sessionId?.trim() || null;

		if (!session_id) {
			const created = await this.deps.memory.createChatSession({
				traceId: input.traceId,
			});
			session_id = created.id;
		}

		const history = (await this.deps.memory.getChatHistory(session_id)) as StoredChatMessage[];
		const chatHistory: ChatTurn[] = history
			.slice()
			.reverse()
			.map((message) => ({
				role: message.role,
				content: message.content,
			}));

		const result = await this.deps.answer.answer({
			query: input.query,
			traceId: input.traceId,
			sessionId: session_id,
			chatHistory,
			documentIds: input.documentIds ?? [],
		});

		return {
			session_id,
			traceId: input.traceId,
			result,
		};
	}
}