import type { Database } from 'better-sqlite3';
import { getKnowledgeDb } from './knowledge-db.ts';
import { KnowledgeStore } from './knowledge-store.ts';
import { KnowledgeConsolidationService } from './knowledge-consolidation-service.ts';
import { KnowledgeTaskProcessor } from './knowledge-task-processor.ts';
import { KnowledgeIngestionService } from './knowledge-ingestion-service.ts';
import type { KnowledgeReflectionType } from '../../shared/knowledge.ts';

export interface KnowledgeDreamResult {
  processedEntities: number;
  deduplicatedClaims: number;
  archivedClaims: number;
  patternsCreated: number;
  profilesUpdated: number;
  createdReflections: number;
}

export class KnowledgeDreamService {
  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    private readonly db: Database = getKnowledgeDb(),
    private readonly consolidationService: KnowledgeConsolidationService = new KnowledgeConsolidationService(store),
    private readonly taskProcessor: KnowledgeTaskProcessor = new KnowledgeTaskProcessor(db, new KnowledgeIngestionService(store), consolidationService)
  ) {}

  /**
   * Five-stage lightweight Dream cycle:
   * Scan -> Deduplicate -> Consolidate -> Reflect -> Decay.
   */
  async runDreamCycle(_options: { force?: boolean } = {}): Promise<KnowledgeDreamResult> {
    // Dream is the main boundary for pending memory tasks. Before scanning L2,
    // finalize active tasks so their accumulated L1 references become L2 concepts.
    await this.taskProcessor.finalizeAllActive('dream');

    const entities = this.scanEntities();
    if (entities.length === 0) {
      return {
        processedEntities: 0,
        deduplicatedClaims: 0,
        archivedClaims: 0,
        patternsCreated: 0,
        profilesUpdated: 0,
        createdReflections: 0
      };
    }

    let deduplicatedClaims = 0;
    let archivedClaims = 0;
    let patternsCreated = 0;
    let profilesUpdated = 0;
    let createdReflections = 0;

    for (const ent of entities) {
      deduplicatedClaims += this.deduplicateEntityClaims(ent.id);
      const consolidated = await this.consolidationService.consolidateEntity(ent.id, { force: true });
      patternsCreated += consolidated.patternsCreated;
      if (consolidated.profileUpdated) profilesUpdated++;
      createdReflections += this.reflectEntity(ent);
      archivedClaims += this.decayEntityClaims(ent.id);
    }

    return {
      processedEntities: entities.length,
      deduplicatedClaims,
      archivedClaims,
      patternsCreated,
      profilesUpdated,
      createdReflections
    };
  }

  private scanEntities(): Array<{ id: string; type: string; canonical_name: string }> {
    return this.db
      .prepare(
        `
        SELECT DISTINCT e.id, e.type, e.canonical_name
        FROM knowledge_entities e
        JOIN knowledge_claims c ON c.entity_id = e.id
        WHERE e.status = 'active' AND c.status = 'active'
        ORDER BY e.updated_at DESC
      `
      )
      .all() as any[];
  }

  private deduplicateEntityClaims(entityId: string): number {
    const rows = this.db
      .prepare(
        `
        SELECT id, normalized_text, created_at
        FROM knowledge_claims
        WHERE entity_id = ? AND status = 'active'
        ORDER BY created_at ASC
      `
      )
      .all(entityId) as Array<{ id: string; normalized_text: string; created_at: string }>;

    const seen = new Map<string, string>();
    let count = 0;
    for (const row of rows) {
      const key = row.normalized_text.trim();
      if (!key) continue;
      const existingId = seen.get(key);
      if (existingId) {
        this.store.updateClaimStatus(row.id, 'superseded', existingId);
        count++;
      } else {
        seen.set(key, row.id);
      }
    }
    return count;
  }

  private reflectEntity(ent: { id: string; type: string; canonical_name: string }): number {
    const claims = this.db
      .prepare(
        `
        SELECT id, text, kind, importance
        FROM knowledge_claims
        WHERE entity_id = ? AND status = 'active'
        ORDER BY importance DESC, updated_at DESC
        LIMIT 80
      `
      )
      .all(ent.id) as any[];

    if (claims.length === 0) return 0;

    const sourceClaimIds = claims.map((c) => String(c.id));
    let reflectionType: KnowledgeReflectionType = 'entity_summary';
    let title = `关于 ${ent.canonical_name} 的知识汇总`;

    if (ent.type === 'person' || ent.type === 'self') {
      reflectionType = 'person_profile';
      title = `${ent.canonical_name} 的人物特征与偏好画像`;
    } else if (ent.type === 'project' || ent.type === 'workspace') {
      reflectionType = 'project_state';
      title = `${ent.canonical_name} 项目背景与最新决策汇总`;
    }

    const bullets = claims.slice(0, 20).map((c) => {
      const kindLabel = c.kind === 'preference' ? '偏好' : c.kind === 'decision' ? '决策' : c.kind === 'constraint' ? '约束' : '事实';
      return `- [${kindLabel}] ${c.text}`;
    });

    const body = `这里是关于 **${ent.canonical_name}** (${ent.type}) 的 Dream 沉淀摘要：\n\n${bullets.join('\n')}\n\n更新时间：${new Date().toISOString().slice(0, 10)}`;

    this.store.upsertProfile({
      entityId: ent.id,
      reflectionType,
      title,
      body,
      sourceClaimIds,
      confidence: 0.86
    });

    return 1;
  }

  private decayEntityClaims(entityId: string): number {
    const rows = this.db
      .prepare(
        `
        SELECT id, confidence, importance, created_at
        FROM knowledge_claims
        WHERE entity_id = ? AND status = 'active'
        ORDER BY created_at ASC
      `
      )
      .all(entityId) as Array<{ id: string; confidence: number; importance: number; created_at: string }>;

    const now = Date.now();
    let archived = 0;
    for (const row of rows) {
      const ageMs = now - new Date(row.created_at).getTime();
      const ageDays = ageMs / 86_400_000;
      if (ageDays > 180 && row.confidence < 0.45 && row.importance < 0.35) {
        this.store.updateClaimStatus(row.id, 'archived', null);
        archived++;
      }
    }
    return archived;
  }
}
