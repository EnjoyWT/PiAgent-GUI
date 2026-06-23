import type Database from 'better-sqlite3';
import { generateId } from '../../shared/id.ts';
import { getCoreV2Service } from '../core-v2/sqlite-db.ts';
import { getKnowledgeDb } from './knowledge-db.ts';
import { buildKnowledgeEpisode } from './episode-builder.ts';
import { KnowledgeIngestionService } from './knowledge-ingestion-service.ts';
import { KnowledgeConsolidationService } from './knowledge-consolidation-service.ts';
import { runOneShotText } from '../llm/one-shot.ts';
import { resolveKnowledgeModel } from './knowledge-settings.ts';

export interface KnowledgeTaskRunInput {
  conversationId: string;
  threadId?: string | null;
  agentRunId?: string | null;
  workspacePath?: string | null;
}

export interface KnowledgeTaskAppendResult {
  taskId: string;
  finalizedTaskId: string | null;
  reason: 'explicit_memory' | 'idle_boundary' | 'topic_boundary' | 'accumulated';
}

export interface ActiveKnowledgeTaskItem {
  id: string;
  conversationId: string;
  threadId: string | null;
  workspacePath: string | null;
  runIds: string[];
  runCount: number;
  startedAt: string;
  updatedAt: string;
  triggerReason: string | null;
  lastUserText: string | null;
}

const IDLE_BOUNDARY_MS = 30 * 60 * 1000;
// Only explicit memory instructions bypass the task boundary and become L2 immediately.
// Ordinary preferences such as "我喜欢吃甜食" are accumulated into the active memory task
// and finalized by idle/topic boundary or Dream, matching MemOS' L1-capture -> task-summary flow.
const EXPLICIT_MEMORY_RE = /(记住|记录|以后|记一下|帮记|帮我记|记一笔|记到|保存一下|存一下|存到记忆|写进记忆|加入记忆)/;

function safeJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export class KnowledgeTaskProcessor {
  constructor(
    private readonly db: Database.Database = getKnowledgeDb(),
    private readonly ingestionService: KnowledgeIngestionService = new KnowledgeIngestionService(),
    private readonly consolidationService: KnowledgeConsolidationService = new KnowledgeConsolidationService(),
    private readonly runOneShot: typeof runOneShotText = runOneShotText
  ) {}

  async appendRun(input: KnowledgeTaskRunInput): Promise<KnowledgeTaskAppendResult> {
    const active = this.getActiveTask(input.threadId ?? null, input.conversationId);
    let taskId = active?.id ?? this.createTask(input, 'active');
    let finalizedTaskId: string | null = null;
    let reason: KnowledgeTaskAppendResult['reason'] = 'accumulated';

    if (active && this.shouldCutIdleBoundary(active.updated_at)) {
      await this.finalizeTask(active.id, 'idle_boundary');
      finalizedTaskId = active.id;
      taskId = this.createTask(input, 'active');
      reason = 'idle_boundary';
    } else if (active && await this.isNewTopicBoundary(active, input)) {
      await this.finalizeTask(active.id, 'topic_boundary');
      finalizedTaskId = active.id;
      taskId = this.createTask(input, 'active');
      reason = 'topic_boundary';
    }

    this.attachRun(taskId, input);

    if (this.isExplicitMemoryTurn(input)) {
      await this.finalizeTask(taskId, 'explicit_memory');
      finalizedTaskId = taskId;
      reason = 'explicit_memory';
    }

    return { taskId, finalizedTaskId, reason };
  }

  listActiveTasks(limit = 50): ActiveKnowledgeTaskItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_memory_tasks WHERE status = 'active' ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as any[];
    const core = getCoreV2Service();
    return rows.map((row) => {
      const runIds = safeJsonArray(row.run_ids_json);
      const fallbackMessages = core.getConversationMessages(row.conversation_id) as any[];
      const taskWindowMessages = fallbackMessages.filter((message) => {
        const createdAt = Date.parse(String(message.createdAt || message.created_at || ''));
        const startedAt = Date.parse(String(row.started_at || ''));
        const updatedAt = Date.parse(String(row.updated_at || ''));
        if (!Number.isFinite(createdAt) || !Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) return false;
        return createdAt >= startedAt - 15_000 && createdAt <= updatedAt + 15_000;
      });
      const fallbackSource = taskWindowMessages.length > 0 ? taskWindowMessages : fallbackMessages;
      const fallbackLastUserText = fallbackSource
        .filter((m) => m.role === 'user')
        .map((m) => String(m.text || '').trim())
        .filter(Boolean)
        .at(-1) ?? null;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        threadId: row.thread_id,
        workspacePath: row.workspace_path,
        runIds,
        runCount: runIds.length,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        triggerReason: row.trigger_reason,
        lastUserText: String(row.last_user_text || row.preview_text || '').trim() || fallbackLastUserText
      } satisfies ActiveKnowledgeTaskItem;
    });
  }

  discardTask(taskId: string, reason = 'discarded'): boolean {
    const task = this.db.prepare(`SELECT id, status FROM knowledge_memory_tasks WHERE id = ?`).get(taskId) as any;
    if (!task || task.status !== 'active') return false;
    this.db
      .prepare(`UPDATE knowledge_memory_tasks SET status = 'skipped', trigger_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
      .run(reason, nowIso(), nowIso(), taskId);
    return true;
  }

  async finalizeAllActive(reason = 'dream'): Promise<number> {
    const rows = this.db
      .prepare(`SELECT id FROM knowledge_memory_tasks WHERE status = 'active' ORDER BY updated_at ASC`)
      .all() as Array<{ id: string }>;
    let count = 0;
    for (const row of rows) {
      await this.finalizeTask(row.id, reason);
      count++;
    }
    return count;
  }

  async finalizeTask(taskId: string, reason = 'manual'): Promise<{ insertedClaims: number; skippedClaims: number; affectedEntityIds: string[] } | null> {
    const task = this.db.prepare(`SELECT * FROM knowledge_memory_tasks WHERE id = ?`).get(taskId) as any;
    if (!task || task.status === 'completed' || task.status === 'skipped') return null;

    const runs = this.db
      .prepare(`SELECT * FROM knowledge_memory_task_runs WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as any[];

    if (runs.length === 0) {
      this.db
        .prepare(`UPDATE knowledge_memory_tasks SET status = 'skipped', trigger_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
        .run(reason, nowIso(), nowIso(), taskId);
      return { insertedClaims: 0, skippedClaims: 0, affectedEntityIds: [] };
    }

    const episode = this.buildTaskEpisode(task, runs);
    const result = await this.ingestionService.ingestEpisode(episode);

    for (const entityId of result.affectedEntityIds) {
      try {
        await this.consolidationService.consolidateEntity(entityId, { force: true });
      } catch (err) {
        console.warn('[knowledge-task] consolidation failed', { entityId, err });
      }
    }

    this.db
      .prepare(`UPDATE knowledge_memory_tasks SET status = 'completed', trigger_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
      .run(reason, nowIso(), nowIso(), taskId);

    return result;
  }

  private getActiveTask(threadId: string | null, conversationId: string): any | null {
    return this.db
      .prepare(
        `
        SELECT * FROM knowledge_memory_tasks
        WHERE status = 'active'
          AND conversation_id = ?
          AND COALESCE(thread_id, '') = COALESCE(?, '')
        ORDER BY updated_at DESC
        LIMIT 1
      `
      )
      .get(conversationId, threadId) as any | null;
  }

  private createTask(input: KnowledgeTaskRunInput, status: 'active'): string {
    const id = generateId();
    const now = nowIso();
    const preview = this.resolveConversationPreview(input.conversationId);
    this.db
      .prepare(
        `
        INSERT INTO knowledge_memory_tasks
          (id, conversation_id, thread_id, workspace_path, status, trigger_reason, run_ids_json, started_at, ended_at, created_at, updated_at, last_user_text, preview_text)
        VALUES (?, ?, ?, ?, ?, NULL, '[]', ?, NULL, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.conversationId,
        input.threadId ?? null,
        input.workspacePath ?? null,
        status,
        now,
        now,
        now,
        preview.lastUserText,
        preview.previewText
      );
    return id;
  }

  private attachRun(taskId: string, input: KnowledgeTaskRunInput): void {
    const id = generateId();
    const now = nowIso();
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO knowledge_memory_task_runs
          (id, task_id, conversation_id, thread_id, agent_run_id, workspace_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(id, taskId, input.conversationId, input.threadId ?? null, input.agentRunId ?? null, input.workspacePath ?? null, now);

    const row = this.db.prepare(`SELECT run_ids_json FROM knowledge_memory_tasks WHERE id = ?`).get(taskId) as any;
    const runIds = safeJsonArray(row?.run_ids_json);
    if (input.agentRunId && !runIds.includes(input.agentRunId)) runIds.push(input.agentRunId);
    const preview = this.resolveConversationPreview(input.conversationId);
    this.db
      .prepare(`UPDATE knowledge_memory_tasks SET run_ids_json = ?, updated_at = ?, last_user_text = COALESCE(?, last_user_text), preview_text = COALESCE(?, preview_text) WHERE id = ?`)
      .run(JSON.stringify(runIds), now, preview.lastUserText, preview.previewText, taskId);
  }

  private shouldCutIdleBoundary(updatedAt: string | null | undefined): boolean {
    if (!updatedAt) return false;
    const updated = new Date(updatedAt).getTime();
    return Number.isFinite(updated) && Date.now() - updated > IDLE_BOUNDARY_MS;
  }

  private async isNewTopicBoundary(activeTask: any, input: KnowledgeTaskRunInput): Promise<boolean> {
    const model = resolveKnowledgeModel('consolidation');
    if (!model) return false;

    const previousRunIds = safeJsonArray(activeTask.run_ids_json);
    if (previousRunIds.length === 0) return false;

    const currentUserText = this.getRunUserText(input).slice(0, 800).trim();
    if (!currentUserText) return false;

    const previousContext = this.buildTaskContextPreview(activeTask, previousRunIds).slice(0, 2500).trim();
    if (!previousContext) return false;

    const systemPrompt = `你是记忆系统的话题边界分类器。判断新的用户输入是否开启了一个新的长期记忆任务。

返回 JSON：{"decision":"SAME"|"NEW","confidence":0.0-1.0,"reason":"简短原因"}

规则：
- SAME：仍在讨论同一主题、同一项目任务、同一个偏好/决策的延续、澄清或重复。
- NEW：明显切换到另一个无关主题/任务/实体，应先沉淀旧任务再开启新任务。
- 对短句、指代句、重复句要保守，优先 SAME。
- 只有 confidence >= 0.72 的 NEW 才算真正边界。`;
    const userPrompt = `【当前 active memory task 摘要/上下文】\n${previousContext}\n\n【新的用户输入】\n${currentUserText}\n\n请判断是否新话题：`;

    try {
      const result = await this.runOneShot({
        modelKeys: [model],
        systemPrompt,
        userPrompt,
        maxTokens: 400,
        timeoutMs: 12000,
        temperature: 0.1
      });
      const text = result?.text?.trim() ?? '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return false;
      const parsed = JSON.parse(match[0]);
      return String(parsed.decision || '').toUpperCase() === 'NEW' && Number(parsed.confidence) >= 0.72;
    } catch (err) {
      console.warn('[knowledge-task] topic classifier failed; keeping SAME topic', err);
      return false;
    }
  }

  private getRunUserText(input: KnowledgeTaskRunInput): string {
    const core = getCoreV2Service();
    const messages = core.getConversationMessages(input.conversationId) as any[];
    const runMessages = input.agentRunId ? messages.filter((m) => m.agentRunId === input.agentRunId || m.agent_run_id === input.agentRunId) : [];
    const candidates = runMessages.length > 0 ? runMessages : messages.slice(-6);
    return candidates.filter((m) => m.role === 'user').map((m) => String(m.text || '')).join('\n');
  }

  private buildTaskContextPreview(activeTask: any, runIds: string[]): string {
    const core = getCoreV2Service();
    const messages = core.getConversationMessages(activeTask.conversation_id) as any[];
    const idSet = new Set(runIds);
    const taskMessages = messages.filter((m) => idSet.has(String(m.agentRunId || m.agent_run_id || ''))).slice(-12);
    const source = taskMessages.length > 0 ? taskMessages : messages.slice(-12);
    return source
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.text || '').slice(0, 500)}`)
      .join('\n');
  }

  private isExplicitMemoryTurn(input: KnowledgeTaskRunInput): boolean {
    const core = getCoreV2Service();
    const messages = core.getConversationMessages(input.conversationId) as any[];
    const runMessages = input.agentRunId ? messages.filter((m) => m.agentRunId === input.agentRunId || m.agent_run_id === input.agentRunId) : [];
    const candidates = runMessages.length > 0 ? runMessages : messages.slice(-6);
    const userText = candidates.filter((m) => m.role === 'user').map((m) => String(m.text || '')).join('\n');
    return EXPLICIT_MEMORY_RE.test(userText);
  }

  private resolveConversationPreview(conversationId: string): { lastUserText: string | null; previewText: string | null } {
    const core = getCoreV2Service();
    const messages = core.getConversationMessages(conversationId) as any[];
    const userTexts = messages
      .filter((message) => message.role === 'user')
      .map((message) => String(message.text || '').trim())
      .filter(Boolean);
    const lastUserText = userTexts.at(-1) ?? null;
    const previewText = lastUserText ? lastUserText.slice(0, 240) : null;
    return { lastUserText, previewText };
  }

  private buildTaskEpisode(task: any, runs: any[]) {
    const core = getCoreV2Service();
    const allMessages = core.getConversationMessages(task.conversation_id) as any[];
    const runIds = new Set(runs.map((r) => String(r.agent_run_id || '')).filter(Boolean));
    let messages = runIds.size > 0 ? allMessages.filter((m) => runIds.has(String(m.agentRunId || m.agent_run_id || ''))) : [];

    // Some projected conversation messages do not carry agentRunId. Fallback to the recent window so
    // the task still produces a useful L2 concept instead of silently losing memory.
    if (messages.length === 0) {
      messages = allMessages.slice(-12);
    }

    return buildKnowledgeEpisode({
      conversationId: task.conversation_id,
      threadId: task.thread_id,
      agentRunId: runIds.size === 1 ? [...runIds][0] : null,
      workspacePath: task.workspace_path,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: m.createdAt
      }))
    });
  }
}
