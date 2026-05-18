import type { Citation } from '../lib/contracts';
import { Badge } from './Badge';
import { Tooltip } from './Tooltip';

function formatScore(n: number | undefined): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return 'n/a';
  return n.toFixed(3);
}

export function CitationBadges({ citations }: { citations?: Citation[] }) {
  const items = citations ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((c) => {
        const score = c.similarity ?? c.score;
        const title = c.document_title ?? c.title ?? 'Untitled document';
        const label = `${title}\nchunk: ${c.chunk_id}\nscore: ${formatScore(score)}`;

        const badge = (
          <Badge>
            <span className="text-slate-300">Source</span>
            <span className="mx-1 text-slate-500">•</span>
            <span className="font-mono text-slate-200">{c.chunk_id.slice(0, 8)}</span>
            <span className="mx-1 text-slate-500">•</span>
            <span className="font-mono text-slate-200">{formatScore(score)}</span>
          </Badge>
        );

        return (
          <Tooltip key={c.chunk_id} label={label}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="hover:opacity-90">
                {badge}
              </a>
            ) : (
              badge
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}
