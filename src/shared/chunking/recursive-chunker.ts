export type Chunk = {
  index: number
  text: string
  startChar: number
  endChar: number
}

export type RecursiveChunkerOptions = {
  /** Minimum chunk size in (approx) tokens. */
  minTokens?: number
  /** Maximum chunk size in (approx) tokens. */
  maxTokens?: number
  /** Overlap between adjacent chunks in (approx) tokens. */
  overlapTokens?: number
}

const DEFAULTS: Required<RecursiveChunkerOptions> = {
  minTokens: 300,
  maxTokens: 800,
  overlapTokens: 100,
}

/**
 * Approximate token count for English-ish text.
 * We avoid bundling a tokenizer in Workers; this heuristic is stable enough for chunk sizing.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0

  // Roughly 1 token ~= 4 chars for English; use a conservative divisor.
  return Math.ceil(trimmed.length / 4)
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function findBestSplitPoint(segment: string): number {
  // Prefer larger separators first.
  const separators = [
    '\n\n',
    '\n',
    '. ',
    '! ',
    '? ',
    '; ',
    ', ',
    ' ',
  ]

  const mid = Math.floor(segment.length / 2)
  const window = clamp(Math.floor(segment.length * 0.25), 200, 4000)
  const start = clamp(mid - window, 0, segment.length)
  const end = clamp(mid + window, 0, segment.length)
  const slice = segment.slice(start, end)

  for (const sep of separators) {
    const idx = slice.lastIndexOf(sep)
    if (idx !== -1) return start + idx + sep.length
  }

  return mid
}

function buildOverlapText(previousChunkText: string, overlapTokens: number): string {
  if (overlapTokens <= 0) return ''
  if (!previousChunkText.trim()) return ''

  const targetChars = overlapTokens * 4
  if (previousChunkText.length <= targetChars) return previousChunkText
  return previousChunkText.slice(previousChunkText.length - targetChars)
}

/**
 * Recursive chunker: produces chunks between 300–800 tokens with 100 token overlap.
 */
export class RecursiveChunker {
  private readonly minTokens: number
  private readonly maxTokens: number
  private readonly overlapTokens: number

  constructor(options: RecursiveChunkerOptions = {}) {
    const o = { ...DEFAULTS, ...options }
    this.minTokens = o.minTokens
    this.maxTokens = o.maxTokens
    this.overlapTokens = o.overlapTokens

    if (this.minTokens <= 0) throw new Error('minTokens must be > 0')
    if (this.maxTokens <= this.minTokens) throw new Error('maxTokens must be > minTokens')
    if (this.overlapTokens < 0) throw new Error('overlapTokens must be >= 0')
  }

  chunk(text: string): Chunk[] {
    const input = text ?? ''
    const trimmed = input.trim()
    if (!trimmed) return []

    // First, recursively split into <= maxTokens-ish segments without overlap.
    const baseSegments = this.recursiveSplit(trimmed, 0)

    // Then, add overlap and finalize chunks.
    const chunks: Chunk[] = []
    for (let i = 0; i < baseSegments.length; i++) {
      const seg = baseSegments[i]
      const prev = chunks[chunks.length - 1]

      const overlapText = prev ? buildOverlapText(prev.text, this.overlapTokens) : ''
      const combinedText = (overlapText + seg.text).trim()

      const startChar = prev ? Math.max(seg.startChar - overlapText.length, 0) : seg.startChar
      const endChar = seg.endChar

      chunks.push({
        index: chunks.length,
        text: combinedText,
        startChar,
        endChar,
      })
    }

    return chunks
  }

  private recursiveSplit(text: string, baseOffset: number): Array<Omit<Chunk, 'index'>> {
    const tokenCount = estimateTokens(text)
    if (tokenCount <= this.maxTokens) {
      return [
        {
          text: text.trim(),
          startChar: baseOffset,
          endChar: baseOffset + text.length,
        },
      ]
    }

    const splitAt = findBestSplitPoint(text)
    const left = text.slice(0, splitAt)
    const right = text.slice(splitAt)

    // If split fails (pathological input), fall back to hard char split around maxTokens.
    if (!left.trim() || !right.trim()) {
      const approxChars = this.maxTokens * 4
      const hardAt = clamp(approxChars, 1, text.length - 1)
      const l = text.slice(0, hardAt)
      const r = text.slice(hardAt)
      return [
        ...this.recursiveSplit(l, baseOffset),
        ...this.recursiveSplit(r, baseOffset + hardAt),
      ]
    }

    const leftParts = this.recursiveSplit(left, baseOffset)
    const rightParts = this.recursiveSplit(right, baseOffset + splitAt)

    // Merge small trailing + leading pieces where possible.
    const merged: Array<Omit<Chunk, 'index'>> = []
    for (const part of [...leftParts, ...rightParts]) {
      const last = merged[merged.length - 1]
      if (!last) {
        merged.push(part)
        continue
      }

      const combined = `${last.text}\n${part.text}`.trim()
      if (estimateTokens(combined) <= this.maxTokens && estimateTokens(last.text) < this.minTokens) {
        merged[merged.length - 1] = {
          text: combined,
          startChar: last.startChar,
          endChar: part.endChar,
        }
      } else {
        merged.push(part)
      }
    }

    return merged
  }
}
