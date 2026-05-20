import * as Sentry from '@sentry/react';

const RELEASE = 'rag@1.0.0';

Sentry.init({
	dsn: "https://d91c553c9d0d2b8bd82e1b6897296551936.ingest.de.sentry.io/4511417310904400",
	release: import.meta.env.VITE_SENTRY_RELEASE ?? RELEASE,
	integrations: [Sentry.browserTracingIntegration()],
	tracesSampleRate: 0.2,
	tracePropagationTargets: [
		'https://prag.ericijeoma7767.workers.dev',
		'http://127.0.0.1:5173',
		'http://localhost:5173',
	],
	debug: true
});