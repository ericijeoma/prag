import { handleRequest, type AppEnv } from './app/routes.js';

const allowedOrigins = [
	'http://127.0.0.1:5173',
	'http://localhost:5173',
	'https://6353ffdb.prag-frontend.pages.dev',
];

function buildCorsHeaders(origin: string | null): Headers {
	const headers = new Headers();

	if (origin && allowedOrigins.includes(origin)) {
		headers.set('Access-Control-Allow-Origin', origin);
	}

	headers.set(
		'Access-Control-Allow-Methods',
		'GET, POST, PUT, DELETE, OPTIONS',
	);

	headers.set(
		'Access-Control-Allow-Headers',
		'Content-Type, Authorization, x-session-id, x-trace-id',
	);

	headers.set('Access-Control-Max-Age', '86400');

	return headers;
}

function withCors(response: Response, origin: string | null): Response {
	const headers = new Headers(response.headers);
	const cors = buildCorsHeaders(origin);

	cors.forEach((value, key) => {
		headers.set(key, value);
	});

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		const origin = request.headers.get('Origin');

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: buildCorsHeaders(origin),
			});
		}

		const response = await handleRequest(request, env);

		return withCors(response, origin);
	},
} satisfies ExportedHandler<AppEnv>;