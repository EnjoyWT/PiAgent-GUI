import { KnowledgeStore } from './knowledge-store.ts';
import type { KnowledgeTraceInput, KnowledgeTraceResult } from '../../shared/knowledge.ts';

export class KnowledgeTraceService {
  constructor(private readonly store: KnowledgeStore = new KnowledgeStore()) {}

  trace(input: KnowledgeTraceInput): KnowledgeTraceResult | null {
    const claimId = (input.claimId || '').trim();
    if (!claimId) {
      return null;
    }

    return this.store.traceClaim(claimId);
  }
}
