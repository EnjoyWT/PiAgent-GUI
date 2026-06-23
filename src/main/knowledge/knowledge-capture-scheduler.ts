import Database from 'better-sqlite3';
import { getKnowledgeDb } from './knowledge-db.ts';
import { generateId } from '../../shared/id.ts';
import { KnowledgeIngestionService } from './knowledge-ingestion-service.ts';
import { KnowledgeConsolidationService } from './knowledge-consolidation-service.ts';
import { getKnowledgeSettings } from './knowledge-settings.ts';
import { KnowledgeTaskProcessor } from './knowledge-task-processor.ts';

export interface KnowledgeJob {
  id: string;
  conversationId: string;
  threadId: string | null;
  agentRunId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorText: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export class KnowledgeCaptureScheduler {
  private running = false;

  constructor(
    private readonly db: Database.Database = getKnowledgeDb(),
    ingestionService: KnowledgeIngestionService = new KnowledgeIngestionService(),
    consolidationService: KnowledgeConsolidationService = new KnowledgeConsolidationService(),
    private readonly taskProcessor: KnowledgeTaskProcessor = new KnowledgeTaskProcessor(db, ingestionService, consolidationService)
  ) {}

  scheduleRun(params: {
    conversationId: string;
    threadId?: string | null;
    agentRunId?: string | null;
    workspacePath?: string | null;
  }): string | null {
    const settings = getKnowledgeSettings();
    if (!settings.enabled || !settings.autoExtractEnabled) return null;
    const id = generateId();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO knowledge_jobs (id, conversation_id, thread_id, agent_run_id, status, error_text, retry_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', NULL, 0, ?, ?)
      `
      )
      .run(
        id,
        params.conversationId,
        params.threadId || null,
        params.agentRunId || null,
        now,
        now
      );

    // Run the processor asynchronously
    void this.pump(params.workspacePath || null);

    return id;
  }

  async pump(workspacePath: string | null = null): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (true) {
        // Find next eligible job: 'pending' or 'failed' (with retry_count < 3)
        const job = this.db
          .prepare(
            `
            SELECT * FROM knowledge_jobs
            WHERE status = 'pending' OR (status = 'failed' AND retry_count < 3)
            ORDER BY created_at ASC
            LIMIT 1
          `
          )
          .get() as any;

        if (!job) break;

        await this.processJob(
          {
            id: job.id,
            conversationId: job.conversation_id,
            threadId: job.thread_id,
            agentRunId: job.agent_run_id,
            status: job.status,
            errorText: job.error_text,
            retryCount: job.retry_count,
            createdAt: job.created_at,
            updatedAt: job.updated_at
          },
          workspacePath
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async processJob(job: KnowledgeJob, workspacePath: string | null): Promise<void> {
    const now = new Date().toISOString();

    // Mark job as running
    this.db
      .prepare(
        `
        UPDATE knowledge_jobs
        SET status = 'running', updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, job.id);

    try {
      // 1. Auto extraction may be disabled while the queued job is waiting.
      const settings = getKnowledgeSettings();
      if (!settings.enabled || !settings.autoExtractEnabled) {
        throw new Error('Knowledge auto extraction is disabled');
      }

      // 2. Run completion no longer writes L2 directly. It appends this run into
      // a memory task. L2 is generated when the task is finalized (explicit memory,
      // idle/topic boundary, Dream, or manual finalize). This mirrors MemOS: turn/run
      // events collect L1 references; higher-level summaries are boundary-triggered.
      await this.taskProcessor.appendRun({
        conversationId: job.conversationId,
        threadId: job.threadId,
        agentRunId: job.agentRunId,
        workspacePath
      });

      // 3. Mark job as completed
      this.db
        .prepare(
          `
          UPDATE knowledge_jobs
          SET status = 'completed', error_text = NULL, updated_at = ?
          WHERE id = ?
        `
        )
        .run(new Date().toISOString(), job.id);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const nextRetry = job.retryCount + 1;

      this.db
        .prepare(
          `
          UPDATE knowledge_jobs
          SET status = 'failed', error_text = ?, retry_count = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(errorText, nextRetry, new Date().toISOString(), job.id);
    }
  }

  listJobs(limit = 50): KnowledgeJob[] {
    const rows = this.db
      .prepare(`SELECT * FROM knowledge_jobs ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      threadId: r.thread_id,
      agentRunId: r.agent_run_id,
      status: r.status,
      errorText: r.error_text,
      retryCount: r.retry_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}

export const knowledgeCaptureScheduler = new KnowledgeCaptureScheduler();
