import type { Citation } from './contracts';

export type CitationMatch = {
  marker: string;
  chunkId: string;
  citation?: Citation;
};

const FOOTNOTE_RE = /【\s*Source:\s*([^】]+)\s*】/g;

/**
 * Replaces footnote markers like: `... 【Source: <chunk_id>】` with a safe markdown link
 * that we can intercept in the markdown renderer.
 *
 * We intentionally use an in-page hash link (`#chunk:<id>`) so it survives markdown URL
 * sanitization and doesn't navigate away.
 */
export function linkifyCitationMarkers(text: string): string {
  return text.replaceAll(FOOTNOTE_RE, (_m, chunkIdRaw: string) => {
    const chunkId = String(chunkIdRaw ?? '').trim();
    if (!chunkId) return '';
    const short = chunkId.slice(0, 8);
    return ` [source:${short}](#chunk:${encodeURIComponent(chunkId)})`;
  });
}

export function extractCitationMatches(text: string, citations?: Citation[]): CitationMatch[] {
  const matches: CitationMatch[] = [];
  const byChunkId = new Map<string, Citation>();
  for (const c of citations ?? []) {
    byChunkId.set(c.chunk_id, c);
  }

  for (const m of text.matchAll(FOOTNOTE_RE)) {
    const chunkId = (m[1] ?? '').trim();
    if (!chunkId) continue;
    matches.push({
      marker: m[0],
      chunkId,
      citation: byChunkId.get(chunkId),
    });
  }
  return matches;
}

export function stripCitationMarkers(text: string): string {
  return text.replaceAll(FOOTNOTE_RE, '').trim();
}
