import { getKnowledgeDb } from './knowledge-db.ts';
import { KnowledgeTaskProcessor } from './knowledge-task-processor.ts';
import { getKnowledgeSettings } from './knowledge-settings.ts';
import { KnowledgeStore } from './knowledge-store.ts';

export class KnowledgeActiveTaskFinalizeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly store = new KnowledgeStore(getKnowledgeDb());
  private readonly taskProcessor = new KnowledgeTaskProcessor();

  async start(intervalMs = 300_000): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, Math.max(30_000, intervalMs));
    await this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(idleMinutes = 30): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = getKnowledgeSettings();
      if (!settings.enabled || !settings.autoExtractEnabled) return;
      const idleBefore = new Date(Date.now() - Math.max(1, idleMinutes) * 60_000).toISOString();
      const taskIds = this.store.listStaleActiveMemoryTaskIds(idleBefore, 20);
      for (const taskId of taskIds) {
        try {
          await this.taskProcessor.finalizeTask(taskId, 'idle_timeout');
        } catch (error) {
          console.error('[knowledge] finalize idle task failed', { taskId, error });
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}

export const knowledgeActiveTaskFinalizeScheduler = new KnowledgeActiveTaskFinalizeScheduler();
