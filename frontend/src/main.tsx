import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App.tsx';
import { initSentry } from './sentry';

initSentry();

const Root = (
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
          <div className="mx-auto max-w-2xl rounded-xl border border-rose-900/60 bg-rose-950/30 p-4">
            <div className="text-sm font-semibold text-rose-200">UI crashed</div>
            <pre className="mt-2 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-rose-100">
              {error instanceof Error ? error.message : String(error)}
            </pre>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
);

createRoot(document.getElementById('root')!).render(Root);
