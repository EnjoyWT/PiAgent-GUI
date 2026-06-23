import * as path from 'node:path';
import type { KnowledgeEntityType, KnowledgeClaimKind, KnowledgeRelationType } from '../../shared/knowledge.ts';
import type { KnowledgeEpisode } from './episode-builder.ts';
import { runOneShotText } from '../llm/one-shot.ts';
import { resolveKnowledgeModel } from './knowledge-settings.ts';

export interface KnowledgeClaimCandidate {
  entityType: KnowledgeEntityType;
  entityName: string;
  kind: KnowledgeClaimKind;
  text: string;
  confidence: number;
  importance: number;
  evidenceExcerpt: string;
}

export interface KnowledgeRelationCandidate {
  fromEntityType: KnowledgeEntityType;
  fromEntityName: string;
  toEntityType: KnowledgeEntityType;
  toEntityName: string;
  relationType: KnowledgeRelationType;
  confidence: number;
}

export interface KnowledgeClaimExtractor {
  extractClaims(episode: KnowledgeEpisode): Promise<KnowledgeClaimCandidate[]>;
}

export interface KnowledgeRelationExtractor {
  extractRelations(
    episode: KnowledgeEpisode,
    claims: { id: string; text: string; entityId: string | null; entityName: string }[]
  ): Promise<KnowledgeRelationCandidate[]>;
}

export class DeterministicKnowledgeRelationExtractor implements KnowledgeRelationExtractor {
  async extractRelations(
    _episode: KnowledgeEpisode,
    claims: { id: string; text: string; entityId: string | null; entityName: string }[]
  ): Promise<KnowledgeRelationCandidate[]> {
    const candidates: KnowledgeRelationCandidate[] = [];

    for (const claim of claims) {
      const text = claim.text;
      if (claim.entityId && (text.includes('负责') || text.includes('参与') || text.includes('在做') || text.includes('working on'))) {
        if (text.includes('PiAgent')) {
          candidates.push({
            fromEntityType: 'person',
            fromEntityName: claim.entityName,
            toEntityType: 'project',
            toEntityName: 'PiAgent',
            relationType: 'works_on',
            confidence: 0.85
          });
        }
      } else if (claim.entityId && (text.includes('喜欢') || text.includes('偏好') || text.includes('prefers'))) {
        if (text.includes('Python') || text.includes('Node')) {
          const conceptName = text.includes('Python') ? 'Python' : 'Node';
          candidates.push({
            fromEntityType: 'person',
            fromEntityName: claim.entityName,
            toEntityType: 'concept',
            toEntityName: conceptName,
            relationType: 'prefers',
            confidence: 0.8
          });
        }
      }
    }

    return candidates;
  }
}

export class DeterministicKnowledgeClaimExtractor implements KnowledgeClaimExtractor {
  async extractClaims(episode: KnowledgeEpisode): Promise<KnowledgeClaimCandidate[]> {
    const candidates: KnowledgeClaimCandidate[] = [];
    const userText = episode.userText || '';

    // Split by common Chinese/English clause boundaries
    const clauses = userText.split(/[\n。！？!?；;]/);

    for (const clause of clauses) {
      const trimmed = clause.trim();
      if (!trimmed) continue;

      const explicitMemory = /(记住|记录|以后|记一下|帮记|帮我记|记一笔|记到|保存一下|存一下|存到记忆|写进记忆|加入记忆)/.test(trimmed);
      const personalPreference = /我\s*(喜欢|爱|偏好|更喜欢|讨厌|不喜欢|最爱|平时最爱)/.test(trimmed);
      const projectPreference = /(偏好|倾向|建议|必须|不要|不允许|只允许|统一|默认)/.test(trimmed);

      if (explicitMemory || personalPreference || projectPreference) {
        let entityName = 'self';
        let entityType: KnowledgeEntityType = 'self';
        let kind: KnowledgeClaimKind = explicitMemory ? 'fact' : 'preference';
        let text = trimmed;

        if (personalPreference) {
          entityName = 'user';
          entityType = 'self';
          kind = 'preference';
          text = trimmed.startsWith('用户') ? trimmed : `用户${trimmed.replace(/^我/, '')}`;
        } else if (episode.workspacePath) {
          try {
            entityName = path.basename(episode.workspacePath) || 'self';
            if (entityName !== 'self') {
              entityType = 'project';
            }
          } catch {
            // fallback
          }
        }

        candidates.push({
          entityType,
          entityName,
          kind,
          text,
          confidence: personalPreference ? 0.75 : 0.55,
          importance: personalPreference ? 0.65 : 0.4,
          evidenceExcerpt: trimmed
        });
      }
    }

    return candidates;
  }
}

/**
 * LLM-based claim extractor that extracts structured claims from dynamic conversation.
 * If LLM is not configured, or if invocation fails, it gracefully falls back to rule-based extraction.
 */
export class ModelKnowledgeClaimExtractor implements KnowledgeClaimExtractor {
  private readonly fallback = new DeterministicKnowledgeClaimExtractor();
  private readonly runOneShot: typeof runOneShotText;

  constructor(deps?: { runOneShotText?: typeof runOneShotText }) {
    this.runOneShot = deps?.runOneShotText || runOneShotText;
  }

  async extractClaims(episode: KnowledgeEpisode): Promise<KnowledgeClaimCandidate[]> {
    const toolModel = resolveKnowledgeModel('extraction');
    if (!toolModel) {
      return this.fallback.extractClaims(episode);
    }

    const systemPrompt = `你是一个知识抽取助手。从给定的对话记录中提取值得长期记住的事实、用户偏好、技术决策和约束条件。

规则：
1. 只提取对未来对话有持续价值的信息（例如用户喜欢的技术栈、项目重大架构决策、特定的工作习惯）。忽略临时性的、只在当前对话中瞬间有意义的零碎讨论。
2. 每条提取出来的信息应该是一句独立的、可理解的、上下文完整陈述（不要含有"他/她/它"等含糊的代词，将其替换成明确的实体名，如"用户"、"项目"、"PiAgent"）。
3. 不要提取代码片段、冗长的错误日志，只提取其背后的核心结论或事实。
4. 过滤掉显而易见的业界通用常识（例如 "git 用于版本控制"、"TypeScript 具有类型安全" 不需要记录）。
5. 如果对话中没有任何值得长期保存的有用记忆，必须返回空数组。

提取项字段必须包含：
- entityName: 记忆关联的实体名。
  * 如果是关于用户自身的偏好/习惯/背景，必须填 "user"。
  * 如果是关于当前项目的，填当前项目名（如 "PiAgent"）。
  * 如果是关于特定技术/工具本身的，填该技术名（如 "Docker"、"Electron"）。
- entityType: 实体类型，可选值为 "person", "project", "concept", "organization", "self"。对于 "user" 填 "self" 或 "person"。
- kind: 记忆类型，可选值为 "fact"（事实）, "preference"（偏好）, "decision"（决策）, "constraint"（约束）, "skill"（能力/经验）。
- text: 总结好的一句中文陈述。
- confidence: 置信度 (0.0 至 1.0 之间的浮点数)。
- importance: 重要度 (0.0 至 1.0 之间的浮点数)。
- evidenceExcerpt: 对话中该信息产生的最关键原文句子。

请严格以 JSON 数组格式返回，格式如下：
[
  {
    "entityName": "...",
    "entityType": "...",
    "kind": "...",
    "text": "...",
    "confidence": 0.85,
    "importance": 0.7,
    "evidenceExcerpt": "..."
  }
]
若无则直接返回 []。`;

    const userPrompt = `请从以下对话记录和工作区上下文中提取值得长期记住的信息：

## 用户消息
${episode.userText || '(空)'}

## 助手消息
${episode.assistantText || '(空)'}

## 工具调用摘要
${episode.toolSummaries || '(空)'}

## 当前工作区路径
${episode.workspacePath || '(无)'}

请提取记忆：`;

    try {
      const result = await this.runOneShot({
        modelKeys: [toolModel],
        systemPrompt,
        userPrompt,
        maxTokens: 1500,
        timeoutMs: 15000,
        temperature: 0.1
      });

      if (!result || !result.text) {
        return this.fallback.extractClaims(episode);
      }

      const text = result.text.trim();
      const startIdx = text.indexOf('[');
      const endIdx = text.lastIndexOf(']');
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return this.fallback.extractClaims(episode);
      }

      const jsonStr = text.slice(startIdx, endIdx + 1);
      const list = JSON.parse(jsonStr);
      if (!Array.isArray(list)) {
        return this.fallback.extractClaims(episode);
      }

      const candidates: KnowledgeClaimCandidate[] = [];
      for (const item of list) {
        if (!item.text || !item.entityName) continue;
        candidates.push({
          entityName: String(item.entityName),
          entityType: (item.entityType || 'concept') as any,
          kind: (item.kind || 'fact') as any,
          text: String(item.text),
          confidence: typeof item.confidence === 'number' ? item.confidence : 0.7,
          importance: typeof item.importance === 'number' ? item.importance : 0.5,
          evidenceExcerpt: String(item.evidenceExcerpt || item.text)
        });
      }

      return candidates;
    } catch (err) {
      console.warn('[knowledge-extractor] LLM extraction failed, using fallback', err);
      return this.fallback.extractClaims(episode);
    }
  }
}
