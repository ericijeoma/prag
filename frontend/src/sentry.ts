import * as Sentry from '@sentry/react';

// If you have a DSN, set it in Vite env as: VITE_SENTRY_DSN=...
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry(): void {
  // Safe default: initialize only if DSN is provided
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // keep sampling conservative by default
    tracesSampleRate: 0.1,
  });
}
