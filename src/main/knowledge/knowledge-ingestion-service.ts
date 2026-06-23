import { KnowledgeStore } from './knowledge-store.ts';
import { ModelKnowledgeClaimExtractor, DeterministicKnowledgeRelationExtractor } from './claim-extractor.ts';
import { OnnxEmbeddingEngine } from './embedding/onnx-embedding-engine.ts';
import type { EmbeddingEngine } from './embedding/onnx-embedding-engine.ts';
import type { KnowledgeClaimExtractor, KnowledgeRelationExtractor } from './claim-extractor.ts';
import type { KnowledgeEpisode } from './episode-builder.ts';
import { runOneShotText } from '../llm/one-shot.ts';
import { getKnowledgeSettings, resolveKnowledgeModel } from './knowledge-settings.ts';
export class KnowledgeIngestionService {
  private readonly embeddingEngine: EmbeddingEngine;
  private readonly runOneShot: typeof runOneShotText;

  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    private readonly extractor: KnowledgeClaimExtractor = new ModelKnowledgeClaimExtractor(),
    private readonly relationExtractor: KnowledgeRelationExtractor = new DeterministicKnowledgeRelationExtractor(),
    deps?: {
      embeddingEngine?: EmbeddingEngine;
      runOneShotText?: typeof runOneShotText;
    }
  ) {
    this.embeddingEngine = deps?.embeddingEngine || new OnnxEmbeddingEngine(getKnowledgeSettings().embeddingModel);
    this.runOneShot = deps?.runOneShotText || runOneShotText;
  }

  async judgeRelations(
    newClaimText: string,
    candidates: { id: string; text: string }[]
  ): Promise<{ id: string; action: 'NONE' | 'UPDATE' | 'DELETE' | 'DUPLICATE'; mergedText?: string }[]> {
    const toolModel = resolveKnowledgeModel('dedup');
    if (!toolModel) {
      return candidates.map(c => ({ id: c.id, action: 'NONE' }));
    }

    const systemPrompt = `你是一个知识库去重与合并助手。分析一条即将入库的新记忆（claim），与库中已存在的近似记忆进行对比，判断它们的关系，并生成相应的操作。

可用操作：
- DUPLICATE: 新记忆与已有记忆的内容实质完全一致（句式不同但语义一样，或新信息是冗余重复）。此时已有记忆无需更新，亦无需插入新记忆。
- UPDATE: 新记忆是已有记忆的“更新版本”或“补充版本”（例如原本是"项目使用 Node 18"，新记忆是"项目升级到 Node 22"；或者原本是"喜欢写 TS"，新记忆是"除了 TS 也喜欢 Rust"）。此时需要更新，请在 mergedText 中提供合并两句陈述后的最终新句子。
- DELETE: 新记忆直接否定、推翻或使得已有记忆彻底失效（例如原为"我叫张三"，新为"我改名叫李四了"；或者原为"准备用 Docker 部署"，新为"团队决定不使用 Docker，改用裸机"）。
- NONE: 无明显关系，属于两个不相关的独立事实。

返回要求：
对每条给出的已有记忆，返回对应的操作。必须以 JSON 数组格式返回，各元素结构如下：
[
  {
    "id": "已有记忆的 id",
    "action": "DUPLICATE 或 UPDATE 或 DELETE 或 NONE",
    "mergedText": "合并后的全新中文陈述（仅在 UPDATE 时需要，其他时候不要提供）"
  }
]
若无近似候选，返回空数组 []。`;

    const existingStr = candidates.map(c => `ID: ${c.id}\n内容: ${c.text}`).join('\n\n');
    const userPrompt = `【新记忆】
内容: ${newClaimText}

【已存在的近似记忆】
${existingStr}

请判断关系：`;

    try {
      const result = await this.runOneShot({
        modelKeys: [toolModel],
        systemPrompt,
        userPrompt,
        maxTokens: 1000,
        timeoutMs: 15000,
        temperature: 0.1
      });

      if (!result || !result.text) {
        return candidates.map(c => ({ id: c.id, action: 'NONE' }));
      }

      const text = result.text.trim();
      const startIdx = text.indexOf('[');
      const endIdx = text.lastIndexOf(']');
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return candidates.map(c => ({ id: c.id, action: 'NONE' }));
      }

      const list = JSON.parse(text.slice(startIdx, endIdx + 1));
      if (!Array.isArray(list)) {
        return candidates.map(c => ({ id: c.id, action: 'NONE' }));
      }

      return list.map((item: any) => ({
        id: String(item.id),
        action: String(item.action).toUpperCase() as any,
        mergedText: item.mergedText ? String(item.mergedText) : undefined
      }));
    } catch (err) {
      console.warn('[knowledge-dedup] LLM de-duplication judgement failed', err);
      return candidates.map(c => ({ id: c.id, action: 'NONE' }));
    }
  }

  async ingestEpisode(episode: KnowledgeEpisode): Promise<{ insertedClaims: number; skippedClaims: number; insertedRelations: number; affectedEntityIds: string[] }> {
    if (!episode || (!episode.userText && !episode.assistantText)) {
      return { insertedClaims: 0, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: [] };
    }

    const candidates = await this.extractor.extractClaims(episode);
    if (!candidates || candidates.length === 0) {
      return { insertedClaims: 0, skippedClaims: 0, insertedRelations: 0, affectedEntityIds: [] };
    }

    let insertedClaims = 0;
    let skippedClaims = 0;
    const affectedEntityIds = new Set<string>();
    const ingestedClaimsForRelations: { id: string; text: string; entityId: string | null; entityName: string }[] = [];

    for (const cand of candidates) {
      const text = (cand.text || '').trim();
      if (!text) {
        skippedClaims++;
        continue;
      }

      if (cand.confidence < 0.35) {
        skippedClaims++;
        continue;
      }

      // Generate embedding for the candidate claim
      let embedding: Float32Array | null = null;
      try {
        embedding = await this.embeddingEngine.embed(text, 'passage');
      } catch (err) {
        console.warn('[knowledge-ingestion] Failed to generate embedding for claim', err);
      }

      // Upsert related entity
      const entityId = this.store.upsertEntity({
        type: cand.entityType,
        canonicalName: cand.entityName
      });
      affectedEntityIds.add(entityId);

      // Perform de-duplication and updating checks if embedding is available
      let finalClaimText = text;
      let shouldInsert = true;
      let existingMatchedClaimId: string | null = null;

      if (embedding) {
        // Find top 5 candidates in the same entity
        const matches = this.store.searchByEmbedding(embedding, entityId, 5);

        // Cosine > 0.95: Extreme similarity, bypass insert, append evidence directly
        const perfectMatch = matches.find(m => m.score > 0.95);
        if (perfectMatch) {
          shouldInsert = false;
          existingMatchedClaimId = perfectMatch.id;
          skippedClaims++;
        } else {
          // Cosine > 0.78: Potential overlaps, pass to LLM for precise mapping
          const closeMatches = matches.filter(m => m.score > 0.78);
          if (closeMatches.length > 0) {
            const decisions = await this.judgeRelations(text, closeMatches);

            for (const d of decisions) {
              if (d.action === 'DUPLICATE') {
                shouldInsert = false;
                existingMatchedClaimId = d.id;
                skippedClaims++;
                break;
              } else if (d.action === 'UPDATE') {
                // Supersede old claim, and insert new merged one
                this.store.updateClaimStatus(d.id, 'superseded', null); // Will link on insert if needed, but 'superseded' status is crucial
                finalClaimText = d.mergedText || text;
                break;
              } else if (d.action === 'DELETE') {
                // Delete existing claim
                this.store.updateClaimStatus(d.id, 'deleted', null);
                break;
              }
            }
          }
        }
      }

      let claimId: string;
      if (shouldInsert) {
        // Insert the claim
        claimId = this.store.insertClaim({
          entityId,
          kind: cand.kind,
          text: finalClaimText,
          confidence: cand.confidence,
          importance: cand.importance
        });

        // Insert vector
        if (embedding) {
          this.store.insertVector(claimId, 'claim', embedding);
        }
        insertedClaims++;
      } else {
        claimId = existingMatchedClaimId!;
      }

      // Attach supporting evidence reference
      this.store.attachEvidence({
        claimId,
        sourceKind: episode.agentRunId ? 'run' : 'conversation',
        sourceRef: episode.agentRunId || episode.conversationId,
        conversationId: episode.conversationId,
        threadId: episode.threadId,
        agentRunId: episode.agentRunId,
        excerpt: cand.evidenceExcerpt || text
      });

      if (shouldInsert) {
        ingestedClaimsForRelations.push({
          id: claimId,
          text: finalClaimText,
          entityId,
          entityName: cand.entityName
        });
      }
    }

    let insertedRelations = 0;
    if (ingestedClaimsForRelations.length > 0) {
      try {
        const relationCandidates = await this.relationExtractor.extractRelations(episode, ingestedClaimsForRelations);
        for (const relCand of relationCandidates) {
          const fromEntityId = this.store.upsertEntity({
            type: relCand.fromEntityType,
            canonicalName: relCand.fromEntityName
          });
          const toEntityId = this.store.upsertEntity({
            type: relCand.toEntityType,
            canonicalName: relCand.toEntityName
          });
          affectedEntityIds.add(fromEntityId);
          affectedEntityIds.add(toEntityId);

          this.store.insertRelation({
            fromEntityId,
            toEntityId,
            relationType: relCand.relationType,
            confidence: relCand.confidence,
            evidenceClaimId: ingestedClaimsForRelations[0].id
          });
          insertedRelations++;
        }
      } catch (err) {
        console.error('[knowledge] Failed to extract or save relations', err);
      }
    }

    return { insertedClaims, skippedClaims, insertedRelations, affectedEntityIds: Array.from(affectedEntityIds) };
  }
}
