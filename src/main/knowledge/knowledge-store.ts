import Database from 'better-sqlite3';
import { generateId } from '../../shared/id.ts';
import { getKnowledgeDb } from './knowledge-db.ts';
import { normalizeKnowledgeText, makeEntitySlug, buildKnowledgeFtsQuery, segmentChinese } from './knowledge-text.ts';
import type {
  UpsertEntityInput,
  InsertClaimInput,
  AttachEvidenceInput,
  InsertRelationInput,
  InsertReflectionInput,
  EntityRow,
  ClaimRow,
  EvidenceRow
} from './knowledge-types.ts';
import type {
  KnowledgeSearchInput,
  KnowledgeSearchItem,
  KnowledgeTraceResult,
  KnowledgeRelation,
  KnowledgeReflection
} from '../../shared/knowledge.ts';

export class KnowledgeStore {
  constructor(private readonly db: Database.Database = getKnowledgeDb()) {}

  upsertEntity(input: UpsertEntityInput): string {
    const canonicalName = (input.canonicalName || '').trim() || 'Unknown';
    const slug = makeEntitySlug(input.type, canonicalName);
    const now = new Date().toISOString();
    const aliases = input.aliases || [];

    const existing = this.db
      .prepare('SELECT * FROM knowledge_entities WHERE slug = ?')
      .get(slug) as EntityRow | undefined;

    let id: string;
    if (existing) {
      id = existing.id;
      const existingAliases = JSON.parse(existing.aliases_json) as string[];
      const mergedAliases = Array.from(new Set([...existingAliases, ...aliases]));

      this.db
        .prepare(
          `
          UPDATE knowledge_entities
          SET aliases_json = ?, summary = COALESCE(?, summary), updated_at = ?
          WHERE id = ?
        `
        )
        .run(JSON.stringify(mergedAliases), input.summary || null, now, id);
    } else {
      id = generateId();
      this.db
        .prepare(
          `
          INSERT INTO knowledge_entities (id, type, canonical_name, slug, aliases_json, summary, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          id,
          input.type,
          canonicalName,
          slug,
          JSON.stringify(aliases),
          input.summary || null,
          'active',
          now,
          now
        );
    }
    return id;
  }

  insertClaim(input: InsertClaimInput): string {
    const id = generateId();
    const now = new Date().toISOString();
    const normalized = normalizeKnowledgeText(input.text).toLowerCase();

    this.db
      .prepare(
        `
        INSERT INTO knowledge_claims (id, entity_id, kind, text, normalized_text, confidence, importance, status, source_type, valid_from, valid_until, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.entityId,
        input.kind,
        input.text,
        normalized,
        input.confidence ?? 0,
        input.importance ?? 0,
        'active',
        'auto',
        input.validFrom || null,
        input.validUntil || null,
        now,
        now
      );

    // Populate FTS index
    let entityName = '';
    if (input.entityId) {
      const ent = this.db
        .prepare('SELECT canonical_name FROM knowledge_entities WHERE id = ?')
        .get(input.entityId) as { canonical_name: string } | undefined;
      if (ent) {
        entityName = ent.canonical_name;
      }
    }

    this.db
      .prepare(
        `
        INSERT INTO knowledge_claim_fts (claim_id, entity_name, claim_text, evidence_text)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(id, segmentChinese(entityName), segmentChinese(input.text), '');

    return id;
  }

  insertVector(targetId: string, targetType: string, embedding: Float32Array): void {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_vectors (id, target_id, target_type, embedding, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(generateId(), targetId, targetType, buffer, new Date().toISOString());
  }

  searchByEmbedding(queryEmbedding: Float32Array, entityId: string | null, topK: number): { id: string; text: string; kind: string; entityId: string | null; score: number }[] {
    let rows: any[];
    if (entityId) {
      rows = this.db.prepare(`
        SELECT v.target_id, v.embedding, c.text, c.kind, c.entity_id
        FROM knowledge_vectors v
        JOIN knowledge_claims c ON c.id = v.target_id
        WHERE c.entity_id = ? AND c.status = 'active' AND v.target_type = 'claim'
      `).all(entityId) as any[];
    } else {
      rows = this.db.prepare(`
        SELECT v.target_id, v.embedding, c.text, c.kind, c.entity_id
        FROM knowledge_vectors v
        JOIN knowledge_claims c ON c.id = v.target_id
        WHERE c.status = 'active' AND v.target_type = 'claim'
      `).all() as any[];
    }

    const scored = rows.map((row) => {
      const vec = new Float32Array(new Uint8Array(row.embedding).buffer);
      let score = 0;
      const len = Math.min(queryEmbedding.length, vec.length);
      for (let i = 0; i < len; i++) {
        score += queryEmbedding[i] * vec[i];
      }
      return {
        id: row.target_id as string,
        text: row.text as string,
        kind: row.kind as string,
        entityId: row.entity_id as string | null,
        score
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  updateClaimStatus(claimId: string, status: string, supersededBy: string | null = null): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE knowledge_claims
      SET status = ?, superseded_by = ?, updated_at = ?
      WHERE id = ?
    `).run(status, supersededBy, now, claimId);
  }

  deleteClaim(claimId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE knowledge_claims
      SET status = 'deleted', updated_at = ?
      WHERE id = ? AND status != 'deleted'
    `).run(now, claimId);
    this.db.prepare(`DELETE FROM knowledge_vectors WHERE target_id = ? AND target_type = 'claim'`).run(claimId);
    return result.changes > 0;
  }

  deleteReflection(reflectionId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE knowledge_reflections
      SET status = 'deleted', updated_at = ?
      WHERE id = ? AND status != 'deleted'
    `).run(now, reflectionId);
    return result.changes > 0;
  }

  deleteEntity(entityId: string): boolean {
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE knowledge_entities
        SET status = 'deleted', updated_at = ?
        WHERE id = ? AND status != 'deleted'
      `).run(now, entityId);
      this.db.prepare(`UPDATE knowledge_claims SET status = 'deleted', updated_at = ? WHERE entity_id = ? AND status != 'deleted'`).run(now, entityId);
      this.db.prepare(`UPDATE knowledge_reflections SET status = 'deleted', updated_at = ? WHERE entity_id = ? AND status != 'deleted'`).run(now, entityId);
      this.db.prepare(`UPDATE knowledge_relations SET status = 'deleted', updated_at = ? WHERE (from_entity_id = ? OR to_entity_id = ?) AND status != 'deleted'`).run(now, entityId, entityId);
      this.db.prepare(`DELETE FROM knowledge_vectors WHERE target_type = 'claim' AND target_id IN (SELECT id FROM knowledge_claims WHERE entity_id = ?)`).run(entityId);
      return result.changes > 0;
    });
    return tx();
  }

  attachEvidence(input: AttachEvidenceInput): string {
    const id = generateId();
    const now = new Date().toISOString();
    let excerpt = input.excerpt || '';
    if (excerpt.length > 800) {
      excerpt = excerpt.slice(0, 797) + '...';
    }

    this.db
      .prepare(
        `
        INSERT INTO knowledge_evidence_refs (id, claim_id, source_kind, source_ref, conversation_id, thread_id, message_id, agent_run_id, excerpt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.claimId,
        input.sourceKind,
        input.sourceRef,
        input.conversationId || null,
        input.threadId || null,
        input.messageId || null,
        input.agentRunId || null,
        excerpt,
        now
      );

    // Refresh FTS record
    const allEvidences = this.db
      .prepare('SELECT excerpt FROM knowledge_evidence_refs WHERE claim_id = ?')
      .all(input.claimId) as { excerpt: string }[];
    const combinedExcerpt = allEvidences.map((ev) => ev.excerpt).join(' ');

    const claim = this.db
      .prepare('SELECT text, entity_id FROM knowledge_claims WHERE id = ?')
      .get(input.claimId) as { text: string; entity_id: string | null } | undefined;

    if (claim) {
      let entityName = '';
      if (claim.entity_id) {
        const ent = this.db
          .prepare('SELECT canonical_name FROM knowledge_entities WHERE id = ?')
          .get(claim.entity_id) as { canonical_name: string } | undefined;
        if (ent) {
          entityName = ent.canonical_name;
        }
      }

      this.db.prepare('DELETE FROM knowledge_claim_fts WHERE claim_id = ?').run(input.claimId);
      this.db
        .prepare(
          `
          INSERT INTO knowledge_claim_fts (claim_id, entity_name, claim_text, evidence_text)
          VALUES (?, ?, ?, ?)
        `
        )
        .run(input.claimId, segmentChinese(entityName), segmentChinese(claim.text), segmentChinese(combinedExcerpt));
    }

    return id;
  }

  searchClaims(input: KnowledgeSearchInput): KnowledgeSearchItem[] {
    const ftsQuery = buildKnowledgeFtsQuery(input.query);
    const limit = Math.min(50, Math.max(1, input.limit ?? 10));

    let sql = `
      SELECT
        c.id AS claimId,
        c.entity_id AS entityId,
        e.type AS entityType,
        e.canonical_name AS entityName,
        c.kind AS kind,
        c.text AS text,
        c.confidence AS confidence,
        c.importance AS importance,
        c.updated_at AS updatedAt
    `;

    if (ftsQuery) {
      sql += `, fts.bm25_score AS score `;
    } else {
      sql += `, 1.0 AS score `;
    }

    sql += `
      FROM knowledge_claims c
      LEFT JOIN knowledge_entities e ON c.entity_id = e.id
    `;

    if (ftsQuery) {
      sql += `
        JOIN (
          SELECT claim_id, bm25(knowledge_claim_fts) AS bm25_score
          FROM knowledge_claim_fts
          WHERE knowledge_claim_fts MATCH ?
        ) fts ON c.id = fts.claim_id
      `;
    }

    sql += ` WHERE c.status = 'active' `;

    const params: any[] = [];
    if (ftsQuery) {
      params.push(ftsQuery);
    }

    if (input.entityId) {
      sql += ` AND c.entity_id = ? `;
      params.push(input.entityId);
    }

    if (input.entityType && input.entityType !== 'all') {
      sql += ` AND e.type = ? `;
      params.push(input.entityType);
    }

    if (input.kind && input.kind !== 'all') {
      sql += ` AND c.kind = ? `;
      params.push(input.kind);
    }

    if (ftsQuery) {
      sql += ` ORDER BY score ASC, c.importance DESC `;
    } else {
      sql += ` ORDER BY c.importance DESC, c.updated_at DESC `;
    }

    sql += ` LIMIT ? `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => {
      const evidence = this.db
        .prepare('SELECT excerpt FROM knowledge_evidence_refs WHERE claim_id = ? ORDER BY rowid DESC LIMIT 1')
        .get(row.claimId) as { excerpt: string } | undefined;

      return {
        claimId: row.claimId,
        entityId: row.entityId,
        entityType: row.entityType,
        entityName: row.entityName,
        kind: row.kind,
        text: row.text,
        score: ftsQuery ? -row.score : 1.0,
        confidence: row.confidence,
        importance: row.importance,
        evidencePreview: evidence ? evidence.excerpt : null,
        updatedAt: row.updatedAt
      };
    });
  }

  traceClaim(claimId: string): KnowledgeTraceResult | null {
    if (!claimId) return null;

    const claim = this.db
      .prepare('SELECT * FROM knowledge_claims WHERE id = ?')
      .get(claimId) as ClaimRow | undefined;
    if (!claim) {
      return null;
    }

    let entity: EntityRow | null = null;
    if (claim.entity_id) {
      const row = this.db
        .prepare('SELECT * FROM knowledge_entities WHERE id = ?')
        .get(claim.entity_id) as EntityRow | undefined;
      entity = row || null;
    }

    const evidenceRefs = this.db
      .prepare('SELECT * FROM knowledge_evidence_refs WHERE claim_id = ? ORDER BY rowid DESC')
      .all(claimId) as EvidenceRow[];

    return {
      claim: {
        id: claim.id,
        entityId: claim.entity_id,
        kind: claim.kind as any,
        text: claim.text,
        normalizedText: claim.normalized_text,
        confidence: claim.confidence,
        importance: claim.importance,
        status: claim.status,
        sourceType: claim.source_type,
        validFrom: claim.valid_from,
        validUntil: claim.valid_until,
        createdAt: claim.created_at,
        updatedAt: claim.updated_at
      },
      entity: entity
        ? {
            id: entity.id,
            type: entity.type as any,
            canonicalName: entity.canonical_name,
            slug: entity.slug,
            aliases: JSON.parse(entity.aliases_json),
            summary: entity.summary,
            status: entity.status,
            createdAt: entity.created_at,
            updatedAt: entity.updated_at
          }
        : null,
      evidenceRefs: evidenceRefs.map((ev) => ({
        id: ev.id,
        claimId: ev.claim_id,
        sourceKind: ev.source_kind,
        sourceRef: ev.source_ref,
        conversationId: ev.conversation_id,
        threadId: ev.thread_id,
        messageId: ev.message_id,
        agentRunId: ev.agent_run_id,
        excerpt: ev.excerpt,
        createdAt: ev.created_at
      }))
    };
  }

  insertRelation(input: InsertRelationInput): string {
    const id = generateId();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO knowledge_relations (id, from_entity_id, to_entity_id, relation_type, confidence, evidence_claim_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `
      )
      .run(
        id,
        input.fromEntityId,
        input.toEntityId,
        input.relationType,
        input.confidence ?? 0,
        input.evidenceClaimId || null,
        now,
        now
      );

    return id;
  }

  getRelationsForEntity(entityId: string): KnowledgeRelation[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM knowledge_relations
        WHERE (from_entity_id = ? OR to_entity_id = ?) AND status = 'active'
        ORDER BY created_at DESC
      `
      )
      .all(entityId, entityId) as any[];

    return rows.map((r) => ({
      id: r.id,
      fromEntityId: r.from_entity_id,
      toEntityId: r.to_entity_id,
      relationType: r.relation_type,
      confidence: r.confidence,
      evidenceClaimId: r.evidence_claim_id,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  insertReflection(input: InsertReflectionInput): string {
    const id = generateId();
    const now = new Date().toISOString();
    const sourceClaimIds = input.sourceClaimIds || [];

    this.db
      .prepare(
        `
        INSERT INTO knowledge_reflections (id, entity_id, reflection_type, title, body, source_claim_ids_json, confidence, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `
      )
      .run(
        id,
        input.entityId,
        input.reflectionType,
        input.title,
        input.body,
        JSON.stringify(sourceClaimIds),
        input.confidence ?? 0,
        now,
        now
      );

    return id;
  }

  getReflectionsForEntity(entityId: string): KnowledgeReflection[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM knowledge_reflections
        WHERE entity_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `
      )
      .all(entityId) as any[];

    return rows.map((r) => this.mapReflectionRow(r));
  }

  getPatternsByEntity(entityId: string): KnowledgeReflection[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM knowledge_reflections
        WHERE entity_id = ? AND reflection_type = 'pattern' AND status = 'active'
        ORDER BY confidence DESC, updated_at DESC
      `
      )
      .all(entityId) as any[];

    return rows.map((r) => this.mapReflectionRow(r));
  }

  replacePatterns(entityId: string, patterns: Array<{ title: string; body: string; sourceClaimIds?: string[]; confidence?: number }>): string[] {
    const now = new Date().toISOString();
    const ids: string[] = [];
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE knowledge_reflections
        SET status = 'superseded', updated_at = ?
        WHERE entity_id = ? AND reflection_type = 'pattern' AND status = 'active'
      `).run(now, entityId);

      for (const pattern of patterns) {
        const id = this.insertReflection({
          entityId,
          reflectionType: 'pattern',
          title: pattern.title,
          body: pattern.body,
          sourceClaimIds: pattern.sourceClaimIds || [],
          confidence: pattern.confidence ?? 0.75
        });
        ids.push(id);
      }
    });
    tx();
    return ids;
  }

  getLatestProfile(entityId: string): KnowledgeReflection | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM knowledge_reflections
        WHERE entity_id = ?
          AND reflection_type IN ('person_profile', 'project_state', 'entity_summary')
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `
      )
      .get(entityId) as any | undefined;

    return row ? this.mapReflectionRow(row) : null;
  }

  upsertProfile(input: { entityId: string; reflectionType: any; title: string; body: string; sourceClaimIds?: string[]; confidence?: number }): string {
    const existing = this.getLatestProfile(input.entityId);
    const now = new Date().toISOString();
    if (existing) {
      this.db.prepare(`
        UPDATE knowledge_reflections
        SET reflection_type = ?, title = ?, body = ?, source_claim_ids_json = ?, confidence = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.reflectionType,
        input.title,
        input.body,
        JSON.stringify(input.sourceClaimIds || []),
        input.confidence ?? existing.confidence,
        now,
        existing.id
      );
      return existing.id;
    }

    return this.insertReflection({
      entityId: input.entityId,
      reflectionType: input.reflectionType,
      title: input.title,
      body: input.body,
      sourceClaimIds: input.sourceClaimIds || [],
      confidence: input.confidence ?? 0.8
    });
  }

  countClaimsSince(entityId: string, sinceIso?: string | null): number {
    if (sinceIso) {
      const row = this.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_claims
        WHERE entity_id = ? AND status = 'active' AND created_at > ?
      `).get(entityId, sinceIso) as { count: number };
      return row.count;
    }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_claims
      WHERE entity_id = ? AND status = 'active'
    `).get(entityId) as { count: number };
    return row.count;
  }

  countPatternsSince(entityId: string, sinceIso?: string | null): number {
    if (!sinceIso) return this.getPatternsByEntity(entityId).length;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM knowledge_reflections
      WHERE entity_id = ? AND reflection_type = 'pattern' AND status = 'active' AND updated_at > ?
    `).get(entityId, sinceIso) as { count: number };
    return row.count;
  }

  getStats(): { entities: number; activeClaims: number; activeTasks: number; taskRuns: number; patterns: number; profiles: number; relations: number; vectors: number } {
    const one = (sql: string): number => (this.db.prepare(sql).get() as { count: number }).count;
    return {
      entities: one(`SELECT COUNT(*) AS count FROM knowledge_entities WHERE status = 'active'`),
      activeClaims: one(`SELECT COUNT(*) AS count FROM knowledge_claims WHERE status = 'active'`),
      activeTasks: one(`SELECT COUNT(*) AS count FROM knowledge_memory_tasks WHERE status = 'active'`),
      taskRuns: one(`SELECT COUNT(*) AS count FROM knowledge_memory_task_runs`),
      patterns: one(`SELECT COUNT(*) AS count FROM knowledge_reflections WHERE status = 'active' AND reflection_type = 'pattern'`),
      profiles: one(`SELECT COUNT(*) AS count FROM knowledge_reflections WHERE status = 'active' AND reflection_type IN ('person_profile', 'project_state', 'entity_summary')`),
      relations: one(`SELECT COUNT(*) AS count FROM knowledge_relations WHERE status = 'active'`),
      vectors: one(`SELECT COUNT(*) AS count FROM knowledge_vectors`)
    };
  }

  listActiveMemoryTasks(limit = 50): Array<{
    id: string;
    conversationId: string;
    threadId: string | null;
    workspacePath: string | null;
    runIds: string[];
    runCount: number;
    startedAt: string;
    updatedAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT id, conversation_id, thread_id, workspace_path, run_ids_json, started_at, updated_at
      FROM knowledge_memory_tasks
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map((row) => {
      const runIds = JSON.parse(row.run_ids_json || '[]');
      return {
        id: row.id,
        conversationId: row.conversation_id,
        threadId: row.thread_id,
        workspacePath: row.workspace_path,
        runIds,
        runCount: Array.isArray(runIds) ? runIds.length : 0,
        startedAt: row.started_at,
        updatedAt: row.updated_at
      };
    });
  }

  listStaleActiveMemoryTaskIds(idleBeforeIso: string, limit = 50): string[] {
    const rows = this.db.prepare(`
      SELECT id
      FROM knowledge_memory_tasks
      WHERE status = 'active'
        AND updated_at <= ?
      ORDER BY updated_at ASC
      LIMIT ?
    `).all(idleBeforeIso, limit) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  listActiveEntities(limit = 100): { id: string; type: any; canonicalName: string; aliases: string[]; summary: string | null; updatedAt: string }[] {
    const rows = this.db.prepare(`
      SELECT id, type, canonical_name, aliases_json, summary, updated_at
      FROM knowledge_entities
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      canonicalName: row.canonical_name,
      aliases: JSON.parse(row.aliases_json || '[]'),
      summary: row.summary,
      updatedAt: row.updated_at
    }));
  }

  getEntity(entityId: string): { id: string; type: any; canonicalName: string; aliases: string[]; summary: string | null } | null {
    const row = this.db.prepare(`
      SELECT id, type, canonical_name, aliases_json, summary
      FROM knowledge_entities
      WHERE id = ?
    `).get(entityId) as any | undefined;
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      canonicalName: row.canonical_name,
      aliases: JSON.parse(row.aliases_json || '[]'),
      summary: row.summary
    };
  }

  getEntityExplorer(entityId: string): {
    entity: ReturnType<KnowledgeStore['getEntity']>;
    profiles: KnowledgeReflection[];
    patterns: KnowledgeReflection[];
    claims: KnowledgeSearchItem[];
    relations: KnowledgeRelation[];
  } | null {
    const entity = this.getEntity(entityId);
    if (!entity) return null;
    const reflections = this.getReflectionsForEntity(entityId);
    return {
      entity,
      profiles: reflections.filter((r) => r.reflectionType !== 'pattern'),
      patterns: reflections.filter((r) => r.reflectionType === 'pattern'),
      claims: this.searchClaims({ query: '', entityId, limit: 200 }),
      relations: this.getRelationsForEntity(entityId)
    };
  }

  listAllClaims(options: { limit?: number; offset?: number; from?: string; to?: string; query?: string } | number = 200): {
    items: KnowledgeSearchItem[];
    total: number;
  } {
    const normalized = typeof options === 'number' ? { limit: options } : options;
    const limit = Math.min(200, Math.max(1, Number(normalized.limit || 20)));
    const offset = Math.max(0, Number(normalized.offset || 0));
    const where = [`c.status = 'active'`];
    const params: any[] = [];
    if (normalized.from) {
      where.push(`c.updated_at >= ?`);
      params.push(normalized.from);
    }
    if (normalized.to) {
      where.push(`c.updated_at <= ?`);
      params.push(normalized.to);
    }
    const query = String(normalized.query || '').trim();
    if (query) {
      where.push(`(c.text LIKE ? OR c.kind LIKE ? OR e.canonical_name LIKE ? OR e.type LIKE ?)`);
      const term = `%${query}%`;
      params.push(term, term, term, term);
    }
    const whereSql = where.join(' AND ');
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(1) AS count
         FROM knowledge_claims c
         LEFT JOIN knowledge_entities e ON c.entity_id = e.id
         WHERE ${whereSql}`
      )
      .get(...params) as { count: number } | undefined;
    const total = Number(totalRow?.count || 0);
    const items = this.db
      .prepare(
        `SELECT
          c.id AS claimId,
          c.entity_id AS entityId,
          e.type AS entityType,
          e.canonical_name AS entityName,
          c.kind AS kind,
          c.text AS text,
          c.confidence AS confidence,
          c.importance AS importance,
          c.updated_at AS updatedAt,
          1.0 AS score
        FROM knowledge_claims c
        LEFT JOIN knowledge_entities e ON c.entity_id = e.id
        WHERE ${whereSql}
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as KnowledgeSearchItem[];
    return { items, total };
  }

  listAllReflections(
    type: 'pattern' | 'profile',
    options: { limit?: number; offset?: number; from?: string; to?: string; query?: string } | number = 200
  ): { items: KnowledgeReflection[]; total: number } {
    const normalized = typeof options === 'number' ? { limit: options } : options;
    const limit = Math.min(200, Math.max(1, Number(normalized.limit || 20)));
    const offset = Math.max(0, Number(normalized.offset || 0));
    const where = [`r.status = 'active'`];
    const params: any[] = [];
    if (type === 'pattern') {
      where.push(`r.reflection_type = 'pattern'`);
    } else {
      where.push(`r.reflection_type IN ('person_profile', 'project_state', 'entity_summary')`);
    }
    if (normalized.from) {
      where.push(`r.updated_at >= ?`);
      params.push(normalized.from);
    }
    if (normalized.to) {
      where.push(`r.updated_at <= ?`);
      params.push(normalized.to);
    }
    const query = String(normalized.query || '').trim();
    if (query) {
      where.push(`(r.title LIKE ? OR r.body LIKE ? OR e.canonical_name LIKE ? OR e.type LIKE ?)`);
      const term = `%${query}%`;
      params.push(term, term, term, term);
    }
    const whereSql = where.join(' AND ');
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(1) AS count
         FROM knowledge_reflections r
         LEFT JOIN knowledge_entities e ON r.entity_id = e.id
         WHERE ${whereSql}`
      )
      .get(...params) as { count: number } | undefined;
    const total = Number(totalRow?.count || 0);
    const items = this.db
      .prepare(
        `SELECT r.* FROM knowledge_reflections r
         LEFT JOIN knowledge_entities e ON r.entity_id = e.id
         WHERE ${whereSql}
         ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
      .map((r: any) => this.mapReflectionRow(r));
    return { items, total };
  }

  private mapReflectionRow(r: any): KnowledgeReflection {
    return {
      id: r.id,
      entityId: r.entity_id,
      reflectionType: r.reflection_type,
      title: r.title,
      body: r.body,
      sourceClaimIds: JSON.parse(r.source_claim_ids_json || '[]') as string[],
      confidence: r.confidence,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  findEntitiesByName(name: string): { id: string; canonical_name: string; type: string }[] {
    const term = `%${name}%`;
    return this.db.prepare(`
      SELECT id, canonical_name, type FROM knowledge_entities
      WHERE (canonical_name LIKE ? OR aliases_json LIKE ?) AND status = 'active'
    `).all(term, term) as any[];
  }

  getClaimsByEntity(entityId: string, status: string = 'active'): { id: string; text: string; kind: string; importance: number; entityId: string | null }[] {
    return this.db.prepare(`
      SELECT id, text, kind, importance, entity_id AS entityId FROM knowledge_claims
      WHERE entity_id = ? AND status = ?
    `).all(entityId, status) as any[];
  }

  getClaimById(claimId: string): { id: string; entityId: string | null; entityType: any; entityName: string | null; kind: any; text: string; confidence: number; importance: number; updatedAt: string } | null {
    const row = this.db.prepare(`
      SELECT
        c.id AS claimId,
        c.entity_id AS entityId,
        e.type AS entityType,
        e.canonical_name AS entityName,
        c.kind AS kind,
        c.text AS text,
        c.confidence AS confidence,
        c.importance AS importance,
        c.updated_at AS updatedAt
      FROM knowledge_claims c
      LEFT JOIN knowledge_entities e ON c.entity_id = e.id
      WHERE c.id = ?
    `).get(claimId) as any;

    if (!row) return null;
    return {
      id: row.claimId,
      entityId: row.entityId,
      entityType: row.entityType,
      entityName: row.entityName,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence,
      importance: row.importance,
      updatedAt: row.updatedAt
    };
  }
}
