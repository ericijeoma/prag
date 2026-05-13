import { describe, expect, it } from 'vitest'

import { RecursiveChunker, estimateTokens } from '../../src/shared/chunking/recursive-chunker.js'

describe('RecursiveChunker', () => {
  it('returns empty array for empty/whitespace input', () => {
    const chunker = new RecursiveChunker()
    expect(chunker.chunk('')).toEqual([])
    expect(chunker.chunk('   \n\n  ')).toEqual([])
  })

  it('keeps short text as a single chunk', () => {
    const chunker = new RecursiveChunker()
    const text = 'Hello world. '.repeat(50)
    const chunks = chunker.chunk(text)
    expect(chunks.length).toBe(1)
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].text.length).toBeGreaterThan(0)
  })

  it('splits long text into multiple chunks not exceeding maxTokens (approx)', () => {
    const chunker = new RecursiveChunker({ maxTokens: 800, minTokens: 300, overlapTokens: 100 })

    // Create ~4000+ tokens (approx): 4 chars/token heuristic => 16k chars.
    const para = 'This is a sentence in a paragraph. '.repeat(100)
    const text = Array.from({ length: 40 }, () => para).join('\n\n')

    const chunks = chunker.chunk(text)
    expect(chunks.length).toBeGreaterThan(1)

    for (const c of chunks) {
      const t = estimateTokens(c.text)
      expect(t).toBeLessThanOrEqual(900) // allow slack because overlap + heuristic
      expect(c.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('applies overlap between adjacent chunks (approx 100 tokens)', () => {
    const chunker = new RecursiveChunker({ maxTokens: 500, minTokens: 300, overlapTokens: 100 })

    const unit = 'abcdef ghijkl mnopqr stuvwx yz. '
    const text = unit.repeat(4000) // very long

    const chunks = chunker.chunk(text)
    expect(chunks.length).toBeGreaterThan(2)

    // Overlap is implemented as last overlapTokens*4 chars of previous chunk.
    const expectedOverlapChars = 100 * 4
    const c0 = chunks[0].text
    const c1 = chunks[1].text

    const overlap = c0.slice(Math.max(0, c0.length - expectedOverlapChars))
    expect(c1.startsWith(overlap.trim().slice(0, 50))).toBe(true)
  })

  it('produces contiguous chunk indices', () => {
    const chunker = new RecursiveChunker({ maxTokens: 500, minTokens: 300, overlapTokens: 100 })
    const text = 'Hello world. '.repeat(5000)
    const chunks = chunker.chunk(text)

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i)
    }
  })
})
