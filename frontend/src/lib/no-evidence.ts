import type { AnswerResult } from './contracts';

const SAFE_FALLBACK = "I don't have enough specific information to answer that.";

export function isNoEvidence(result: Pick<AnswerResult, 'answer' | 'degraded'>): boolean {
  if (result.degraded) return true;
  return result.answer?.trim() === SAFE_FALLBACK;
}
