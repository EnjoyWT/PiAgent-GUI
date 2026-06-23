import { KnowledgeStore } from './knowledge-store.ts';
import { KnowledgeRetrievalService } from './knowledge-retrieval-service.ts';

export interface InjectionPacket {
  profile: string | null;    // L3 长期画像/项目状态
  patterns: string[];        // L2 行为偏好、技能与约束
  claims: string[];          // L1 相关的关联事实
  totalTokens: number;       // 实际占用的预估 Token 数
}

export class InjectionScheduler {
  /**
   * 判断当前 Turn 是否需要进行记忆注入
   */
  shouldInject(context: {
    isFirstMessage: boolean;
    turnsSinceLastInjection: number;
    userMessage: string;
  }): boolean {
    // 1. 新会话的第一条消息，强制注入
    if (context.isFirstMessage) return true;

    // 2. 如果用户消息明确提及了“记得/之前/上次/记忆/memory/recall”等关键词，触发重召回注入
    if (this.mentionsMemory(context.userMessage)) return true;

    // 3. 默认情况下，至少每 8 轮对话重新注入一次，保持记忆新鲜度
    return context.turnsSinceLastInjection >= 8;
  }

  private mentionsMemory(text: string): boolean {
    const keywords = ['记得', '之前', '上次', '记得吗', '你还记', '记忆', '偏好', '习惯', '规则', 'remember', 'recall', 'previous', 'last time', 'preference', 'habit'];
    const normalized = text.toLowerCase();
    return keywords.some(k => normalized.includes(k));
  }
}

export class InjectionRenderer {
  render(packet: InjectionPacket): string {
    const sections: string[] = [];

    if (packet.profile) {
      sections.push(`## About This Context\n${packet.profile}`);
    }

    if (packet.patterns.length > 0) {
      sections.push(`## Known Patterns & Preferences\n${packet.patterns.map(p => `- ${p}`).join('\n')}`);
    }

    if (packet.claims.length > 0) {
      sections.push(`## Relevant Facts\n${packet.claims.map(c => `- ${c}`).join('\n')}`);
    }

    if (sections.length === 0) return '';

    return `<knowledge_memory>\n${sections.join('\n\n')}\n</knowledge_memory>`;
  }
}

export class KnowledgeInjectionService {
  private readonly store: KnowledgeStore;
  private readonly retrieval: KnowledgeRetrievalService;
  private readonly tokenBudget: number; // 默认 8000 tokens

  constructor(
    store: KnowledgeStore = new KnowledgeStore(),
    retrieval: KnowledgeRetrievalService = new KnowledgeRetrievalService(store),
    tokenBudget: number = 8000
  ) {
    this.store = store;
    this.retrieval = retrieval;
    this.tokenBudget = tokenBudget;
  }

  /**
   * 极简高吞吐的 Token 预估函数
   * 中文按照每个字符 0.6 token，英文/空格按 0.35 token
   */
  countTokens(text: string): number {
    let tokens = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 127) {
        tokens += 0.6;
      } else {
        tokens += 0.35;
      }
    }
    return Math.ceil(tokens);
  }

  truncateToTokens(text: string, maxTokens: number): string {
    let tokens = 0;
    let index = 0;
    for (index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      tokens += code > 127 ? 0.6 : 0.35;
      if (tokens > maxTokens) {
        return text.slice(0, index) + '...';
      }
    }
    return text;
  }

  async buildPacket(
    query: string,
    entityId: string | null,
    customBudget?: number
  ): Promise<InjectionPacket> {
    const budget = customBudget || this.tokenBudget;
    const packet: InjectionPacket = {
      profile: null,
      patterns: [],
      claims: [],
      totalTokens: 0
    };

    if (!entityId) return packet;

    // 1. L3 Profile — 长期画像或项目宏观状态（预留 25% 预算）
    const profileBudget = Math.floor(budget * 0.25);
    try {
      // 提取最新的 'person_profile' 或 'project_state' 类型的 reflections
      const reflections = this.store.getReflectionsForEntity(entityId);
      const profileReflection = reflections.find(
        r => r.reflectionType === 'person_profile' || r.reflectionType === 'project_state'
      );
      if (profileReflection) {
        const body = profileReflection.body;
        const truncated = this.truncateToTokens(body, profileBudget);
        packet.profile = truncated;
        packet.totalTokens += this.countTokens(truncated);
      }
    } catch (err) {
      console.warn('[knowledge-injection] Failed to load L3 profile reflection', err);
    }

    // 2. L2 Patterns — 归纳后的行为、习惯或开发约束（预留 37.5% 预算）
    const patternBudget = Math.floor(budget * 0.375);
    let patternTokens = 0;
    try {
      const patternReflections = this.store.getPatternsByEntity(entityId);
      const patternBodies = patternReflections.length > 0
        ? patternReflections.map((p) => p.body)
        : this.store
            .getClaimsByEntity(entityId, 'active')
            .filter((c) => c.kind === 'preference' || c.kind === 'constraint' || c.kind === 'pattern')
            .sort((a, b) => (b.importance || 0) - (a.importance || 0))
            .map((c) => c.text);

      for (const text of patternBodies) {
        const tokens = this.countTokens(text);
        if (patternTokens + tokens > patternBudget) break;
        packet.patterns.push(text);
        patternTokens += tokens;
      }
      packet.totalTokens += patternTokens;
    } catch (err) {
      console.warn('[knowledge-injection] Failed to load L2 patterns', err);
    }

    // 3. L1 Claims — 语义相关的客观事实细节召回（使用剩余的预算）
    const claimBudget = budget - packet.totalTokens;
    let claimTokens = 0;
    try {
      const searchRes = await this.retrieval.search({
        query,
        entityId,
        kind: 'fact', // 仅召回事实型 claim 防止跟偏好重复
        limit: 25
      });

      for (const item of searchRes.items) {
        const tokens = this.countTokens(item.text);
        if (claimTokens + tokens > claimBudget) break;
        packet.claims.push(item.text);
        claimTokens += tokens;
      }
      packet.totalTokens += claimTokens;
    } catch (err) {
      console.warn('[knowledge-injection] Failed to load L1 claims via multi-channel', err);
    }

    return packet;
  }
}
