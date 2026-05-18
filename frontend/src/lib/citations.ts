import type { Citation } from './contracts';

export type CitationMatch = {
  marker: string;
  chunkId: string;
  citation?: Citation;
};

const FOOTNOTE_RE = /【\s*Source:\s*([^】]+)\s*】/g;

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
