import { KnowledgeStore } from './knowledge-store.ts';
import { OnnxEmbeddingEngine } from './embedding/onnx-embedding-engine.ts';
import type { EmbeddingEngine } from './embedding/onnx-embedding-engine.ts';
import type {
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSearchItem
} from '../../shared/knowledge.ts';

export class KnowledgeRetrievalService {
  private readonly store: KnowledgeStore;
  private readonly embeddingEngine: EmbeddingEngine;

  constructor(
    store: KnowledgeStore = new KnowledgeStore(),
    embeddingEngine: EmbeddingEngine = new OnnxEmbeddingEngine()
  ) {
    this.store = store;
    this.embeddingEngine = embeddingEngine;
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const query = (input.query || '').trim();
    if (!query) {
      return {
        query: input.query,
        items: []
      };
    }

    const limit = Math.min(50, Math.max(1, input.limit ?? 10));

    // Parallel fetch from three channels with try-catch safety
    const [ftsResults, embeddingResults, entityResults] = await Promise.all([
      this.fetchFtsChannel(query, input, limit),
      this.fetchEmbeddingChannel(query, input, limit),
      this.fetchEntityChannel(query, input, limit)
    ]);

    // RRF Merge
    const mergedScores = new Map<string, number>();

    const applyChannel = (results: string[], weight: number) => {
      for (let rank = 0; rank < results.length; rank++) {
        const claimId = results[rank];
        const rrfScore = weight / (60 + rank + 1);
        mergedScores.set(claimId, (mergedScores.get(claimId) || 0) + rrfScore);
      }
    };

    applyChannel(ftsResults, 0.3);
    applyChannel(embeddingResults, 0.5);
    applyChannel(entityResults, 0.2);

    // Sort by merged score descending
    const sortedClaims = Array.from(mergedScores.entries())
      .map(([claimId, score]) => ({ claimId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Hydrate detailed records
    const items: KnowledgeSearchItem[] = [];
    for (const { claimId, score } of sortedClaims) {
      const claim = this.store.getClaimById(claimId);
      if (!claim) continue;

      // Filter by type constraints if somehow they slipped through channels
      if (input.entityType && input.entityType !== 'all' && claim.entityType !== input.entityType) {
        continue;
      }
      if (input.kind && input.kind !== 'all' && claim.kind !== input.kind) {
        continue;
      }

      // Trace latest evidence excerpt
      let evidencePreview: string | null = null;
      try {
        const traceResult = this.store.traceClaim(claimId);
        if (traceResult?.evidenceRefs && traceResult.evidenceRefs.length > 0) {
          evidencePreview = traceResult.evidenceRefs[0].excerpt;
        }
      } catch {
        // ignore
      }

      items.push({
        claimId: claim.id,
        entityId: claim.entityId,
        entityType: claim.entityType,
        entityName: claim.entityName,
        kind: claim.kind,
        text: claim.text,
        score, // RRF fused score
        confidence: claim.confidence,
        importance: claim.importance,
        evidencePreview,
        updatedAt: claim.updatedAt
      });
    }

    return {
      query,
      items
    };
  }

  private async fetchFtsChannel(query: string, input: KnowledgeSearchInput, limit: number): Promise<string[]> {
    try {
      const results = this.store.searchClaims({
        query,
        entityId: input.entityId,
        entityType: input.entityType,
        kind: input.kind,
        limit: limit * 2 // Fetch slightly more for RRF ranking depth
      });
      return results.map(r => r.claimId);
    } catch (err) {
      console.warn('[knowledge-retrieval] FTS channel retrieval failed', err);
      return [];
    }
  }

  private async fetchEmbeddingChannel(query: string, input: KnowledgeSearchInput, limit: number): Promise<string[]> {
    try {
      // Ensure embedding engine is up, skip on error
      await this.embeddingEngine.initialize();
      const queryVec = await this.embeddingEngine.embed(query, 'query');
      
      const results = this.store.searchByEmbedding(queryVec, input.entityId || null, limit * 2);

      // Only treat score > 0.01 as semantic overlaps (filter out orthogonal/opposite coordinates)
      let filtered = results.filter(r => r.score > 0.01);
      
      if (input.kind && input.kind !== 'all') {
        filtered = filtered.filter(r => r.kind === input.kind);
      }
      
      return filtered.map(r => r.id);
    } catch (err) {
      console.warn('[knowledge-retrieval] Embedding channel retrieval skipped or failed', err);
      return [];
    }
  }

  private async fetchEntityChannel(query: string, input: KnowledgeSearchInput, limit: number): Promise<string[]> {
    try {
      // Find matching entities by name/aliases
      const entities = this.store.findEntitiesByName(query);
      if (entities.length === 0) return [];

      let claims: any[] = [];
      for (const ent of entities) {
        if (input.entityId && ent.id !== input.entityId) continue;
        if (input.entityType && input.entityType !== 'all' && ent.type !== input.entityType) continue;

        const entityClaims = this.store.getClaimsByEntity(ent.id, 'active');
        claims.push(...entityClaims);
      }

      // Filter by kind if specified
      if (input.kind && input.kind !== 'all') {
        claims = claims.filter(c => c.kind === input.kind);
      }

      // Sort by importance descending
      claims.sort((a, b) => (b.importance || 0) - (a.importance || 0));

      return claims.slice(0, limit * 2).map(c => c.id);
    } catch (err) {
      console.warn('[knowledge-retrieval] Entity channel retrieval failed', err);
      return [];
    }
  }
}
