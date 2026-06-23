import { runOneShotText } from '../llm/one-shot.ts';
import { resolveKnowledgeModel } from './knowledge-settings.ts';
import { KnowledgeStore } from './knowledge-store.ts';
import type { KnowledgeReflectionType } from '../../shared/knowledge.ts';

export interface ConsolidatedPattern {
  title: string;
  body: string;
  sourceClaimIds: string[];
  confidence: number;
}

export interface KnowledgeConsolidationDeps {
  runOneShotText?: typeof runOneShotText;
  now?: () => Date;
}

const CONSOLIDATION_SYSTEM_PROMPT = `你是 PiAgent 的长期记忆整理器。请从碎片化 claims 中归纳 L2 patterns。

要求：
1. 只输出 JSON 数组，不要 Markdown。
2. 每条 pattern 必须可操作，能指导未来行为。
3. 合并重复和相近 claims，保留关键细节。
4. 如果 claims 矛盾，以更新、更具体的信息为准。
5. 不要编造 claims 中没有的信息。

返回格式：
[
  {
    "title": "简短标题",
    "body": "一条清晰、可执行的模式描述",
    "sourceClaimIds": ["claim-id"],
    "confidence": 0.85
  }
]`;

const PROFILE_SYSTEM_PROMPT = `你是 PiAgent 的长期记忆画像维护器。请基于 L2 patterns 生成或更新 L3 profile。

要求：
1. 输出 500 字以内的 Markdown。
2. 保持事实准确，不要编造。
3. 保留最稳定、最重要、最能指导未来对话/编码行为的信息。
4. 如果有现有画像，在其基础上更新，不要无意义重写。
5. 语言简洁。`;

function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePatterns(value: unknown[], validClaimIds: Set<string>): ConsolidatedPattern[] {
  const out: ConsolidatedPattern[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as any;
    const body = typeof obj.body === 'string' ? obj.body.trim() : '';
    if (!body) continue;
    const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 120) : body.slice(0, 40);
    const sourceClaimIds = Array.isArray(obj.sourceClaimIds)
      ? obj.sourceClaimIds.filter((id: unknown): id is string => typeof id === 'string' && validClaimIds.has(id)).slice(0, 20)
      : [];
    const confidence = typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : 0.75;
    out.push({ title, body: body.slice(0, 1200), sourceClaimIds, confidence });
  }
  return out.slice(0, 20);
}

export class PatternConsolidationService {
  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    private readonly deps: KnowledgeConsolidationDeps = {}
  ) {}

  async shouldConsolidate(entityId: string): Promise<boolean> {
    const patterns = this.store.getPatternsByEntity(entityId);
    const lastPattern = patterns[0];
    const newClaimCount = this.store.countClaimsSince(entityId, lastPattern?.updatedAt || null);
    if (!lastPattern) return this.store.countClaimsSince(entityId) >= 2;
    const lastTime = new Date(lastPattern.updatedAt).getTime();
    return newClaimCount >= 5 && Date.now() - lastTime > 3600_000;
  }

  async consolidate(entityId: string): Promise<{ createdPatterns: number; skipped: boolean }> {
    const claims = this.store.getClaimsByEntity(entityId, 'active');
    if (claims.length < 2) return { createdPatterns: 0, skipped: true };

    const existingPatterns = this.store.getPatternsByEntity(entityId);
    let patterns = await this.llmConsolidate(entityId, claims, existingPatterns);
    if (patterns.length === 0) {
      patterns = this.fallbackConsolidate(claims);
    }

    this.store.replacePatterns(entityId, patterns);
    return { createdPatterns: patterns.length, skipped: false };
  }

  private async llmConsolidate(entityId: string, claims: ReturnType<KnowledgeStore['getClaimsByEntity']>, existingPatterns: ReturnType<KnowledgeStore['getPatternsByEntity']>): Promise<ConsolidatedPattern[]> {
    const runText = this.deps.runOneShotText || runOneShotText;
    const claimLines = claims
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 80)
      .map((c, i) => `${i + 1}. [${c.id}] (${c.kind}) ${c.text}`)
      .join('\n');
    const existingLines = existingPatterns.map((p, i) => `${i + 1}. ${p.title}: ${p.body}`).join('\n') || '无';

    try {
      const toolModel = resolveKnowledgeModel('consolidation');
      if (!toolModel) return [];
      const result = await runText({
        modelKeys: [toolModel],
        systemPrompt: CONSOLIDATION_SYSTEM_PROMPT,
        userPrompt: `Entity ID: ${entityId}\n\nClaims:\n${claimLines}\n\nExisting patterns:\n${existingLines}`,
        temperature: 0.1,
        maxTokens: 2000,
        timeoutMs: 20000
      });
      return normalizePatterns(extractJsonArray(result?.text || ''), new Set(claims.map((c) => c.id)));
    } catch (err) {
      console.warn('[knowledge-consolidation] LLM pattern consolidation failed, fallback to deterministic grouping', err);
      return [];
    }
  }

  private fallbackConsolidate(claims: ReturnType<KnowledgeStore['getClaimsByEntity']>): ConsolidatedPattern[] {
    const groups = new Map<string, typeof claims>();
    for (const claim of claims) {
      const key = claim.kind === 'preference' || claim.kind === 'constraint' ? claim.kind : 'fact';
      groups.set(key, [...(groups.get(key) || []), claim]);
    }
    const patterns: ConsolidatedPattern[] = [];
    for (const [kind, items] of groups) {
      if (items.length < 2) continue;
      const title = kind === 'preference' ? '偏好模式' : kind === 'constraint' ? '约束模式' : '事实聚合';
      patterns.push({
        title,
        body: items.slice(0, 5).map((c) => c.text).join('；'),
        sourceClaimIds: items.slice(0, 10).map((c) => c.id),
        confidence: 0.55
      });
    }
    return patterns;
  }
}

export class ProfileMaintenanceService {
  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    private readonly deps: KnowledgeConsolidationDeps = {}
  ) {}

  async shouldUpdateProfile(entityId: string): Promise<boolean> {
    const profile = this.store.getLatestProfile(entityId);
    if (!profile) return this.store.getPatternsByEntity(entityId).length > 0;
    return this.store.countPatternsSince(entityId, profile.updatedAt) >= 1;
  }

  async updateProfile(entityId: string): Promise<{ profileId: string | null; skipped: boolean }> {
    const entity = this.store.getEntity(entityId);
    if (!entity) return { profileId: null, skipped: true };
    const patterns = this.store.getPatternsByEntity(entityId);
    if (patterns.length === 0) return { profileId: null, skipped: true };

    const currentProfile = this.store.getLatestProfile(entityId);
    let body = await this.llmGenerateProfile(entity, patterns, currentProfile?.body || null);
    if (!body) body = this.fallbackProfile(entity, patterns);

    const reflectionType: KnowledgeReflectionType = entity.type === 'person' || entity.type === 'self'
      ? 'person_profile'
      : entity.type === 'project' || entity.type === 'workspace'
        ? 'project_state'
        : 'entity_summary';

    const sourceClaimIds = Array.from(new Set(patterns.flatMap((p) => p.sourceClaimIds))).slice(0, 50);
    const profileId = this.store.upsertProfile({
      entityId,
      reflectionType,
      title: `${entity.canonicalName} Profile`,
      body,
      sourceClaimIds,
      confidence: 0.82
    });
    return { profileId, skipped: false };
  }

  private async llmGenerateProfile(entity: NonNullable<ReturnType<KnowledgeStore['getEntity']>>, patterns: ReturnType<KnowledgeStore['getPatternsByEntity']>, currentProfile: string | null): Promise<string> {
    const runText = this.deps.runOneShotText || runOneShotText;
    const patternLines = patterns.map((p, i) => `${i + 1}. ${p.title}: ${p.body}`).join('\n');
    try {
      const toolModel = resolveKnowledgeModel('dream');
      if (!toolModel) return '';
      const result = await runText({
        modelKeys: [toolModel],
        systemPrompt: PROFILE_SYSTEM_PROMPT,
        userPrompt: `实体：${entity.canonicalName}（${entity.type}）\n\nPatterns:\n${patternLines}\n\n现有画像：\n${currentProfile || '无'}`,
        temperature: 0.1,
        maxTokens: 1000,
        timeoutMs: 20000
      });
      return (result?.text || '').trim().replace(/^```(?:markdown)?\s*/i, '').replace(/```$/i, '').trim().slice(0, 2000);
    } catch (err) {
      console.warn('[knowledge-consolidation] LLM profile update failed, fallback to deterministic profile', err);
      return '';
    }
  }

  private fallbackProfile(entity: NonNullable<ReturnType<KnowledgeStore['getEntity']>>, patterns: ReturnType<KnowledgeStore['getPatternsByEntity']>): string {
    const lines = [`## ${entity.canonicalName}`, `- 类型：${entity.type}`];
    for (const pattern of patterns.slice(0, 8)) {
      lines.push(`- ${pattern.body}`);
    }
    return lines.join('\n');
  }
}

export class KnowledgeConsolidationService {
  readonly patternService: PatternConsolidationService;
  readonly profileService: ProfileMaintenanceService;

  constructor(
    private readonly store: KnowledgeStore = new KnowledgeStore(),
    deps: KnowledgeConsolidationDeps = {}
  ) {
    this.patternService = new PatternConsolidationService(store, deps);
    this.profileService = new ProfileMaintenanceService(store, deps);
  }

  async consolidateEntity(entityId: string, options: { force?: boolean } = {}): Promise<{ patternsCreated: number; profileUpdated: boolean }> {
    let patternsCreated = 0;
    if (options.force || await this.patternService.shouldConsolidate(entityId)) {
      const result = await this.patternService.consolidate(entityId);
      patternsCreated = result.createdPatterns;
    }

    let profileUpdated = false;
    if (options.force || await this.profileService.shouldUpdateProfile(entityId)) {
      const result = await this.profileService.updateProfile(entityId);
      profileUpdated = !result.skipped;
    }

    return { patternsCreated, profileUpdated };
  }

  async consolidateAll(options: { force?: boolean; limit?: number } = {}): Promise<{ processedEntities: number; patternsCreated: number; profilesUpdated: number }> {
    const entities = this.store.listActiveEntities(options.limit ?? 100);
    let processedEntities = 0;
    let patternsCreated = 0;
    let profilesUpdated = 0;
    for (const entity of entities) {
      const result = await this.consolidateEntity(entity.id, options);
      if (result.patternsCreated > 0 || result.profileUpdated) processedEntities++;
      patternsCreated += result.patternsCreated;
      if (result.profileUpdated) profilesUpdated++;
    }
    return { processedEntities, patternsCreated, profilesUpdated };
  }
}
