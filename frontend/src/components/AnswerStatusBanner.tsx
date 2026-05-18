export type AnswerStatus =
  | { kind: 'verified' }
  | { kind: 'unverified' }
  | { kind: 'no-evidence' };

export function AnswerStatusBanner({ status }: { status: AnswerStatus }) {
  if (status.kind === 'verified') {
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-2 text-sm text-emerald-200">
        <div className="font-semibold">Context Authenticated</div>
        <div className="text-emerald-300/80">Answer verified against retrieved context.</div>
      </div>
    );
  }

  if (status.kind === 'unverified') {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
        <div className="font-semibold">Unverified Response Baseline</div>
        <div className="text-amber-300/80">This response could not be fully validated by context.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
      <div className="font-semibold">No Evidence Found</div>
      <div className="text-rose-300/80">Zero contextual evidence was found in the vector database.</div>
    </div>
  );
}
