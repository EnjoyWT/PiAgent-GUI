import { ipcMain, shell } from 'electron';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval-service.ts';
import { OnnxEmbeddingEngine } from '../knowledge/embedding/onnx-embedding-engine.ts';
import { KnowledgeTraceService } from '../knowledge/knowledge-trace-service.ts';
import { KnowledgeIngestionService } from '../knowledge/knowledge-ingestion-service.ts';
import { KnowledgeStore } from '../knowledge/knowledge-store.ts';
import { KnowledgeDreamService } from '../knowledge/knowledge-dream-service.ts';
import { KnowledgeTaskProcessor } from '../knowledge/knowledge-task-processor.ts';
import {
  getKnowledgeSettings,
  isThreadKnowledgeCaptureEnabled,
  setKnowledgeSettings,
  setThreadKnowledgeCaptureEnabled
} from '../knowledge/knowledge-settings.ts';
import {
  downloadLocalKnowledgeEmbeddingModel,
  getKnowledgeEmbeddingModelCacheDir,
  listKnownKnowledgeEmbeddingModels
} from '../knowledge/embedding/embedding-catalog.ts';
import type { KnowledgeSearchInput, KnowledgeTraceInput } from '../../shared/knowledge.ts';
import type { KnowledgeEpisode } from '../knowledge/episode-builder.ts';

export function setupKnowledgeHandlers(options?: {
  ipcMainLike?: {
    handle: (channel: string, listener: (...args: any[]) => any) => void;
  };
  retrievalService?: KnowledgeRetrievalService;
  traceService?: KnowledgeTraceService;
  ingestionService?: KnowledgeIngestionService;
  store?: KnowledgeStore;
  dreamService?: KnowledgeDreamService;
}): void {
  const ipc = options?.ipcMainLike || ipcMain;
  const settings = getKnowledgeSettings();
  const retrieval = options?.retrievalService || new KnowledgeRetrievalService(undefined, new OnnxEmbeddingEngine(settings.embeddingModel));
  const trace = options?.traceService || new KnowledgeTraceService();
  const ingestion = options?.ingestionService || new KnowledgeIngestionService();
  const store = options?.store || new KnowledgeStore();
  const dream = options?.dreamService || new KnowledgeDreamService(store);
  const taskProcessor = new KnowledgeTaskProcessor();

  ipc.handle('knowledge:search', async (_event, input: KnowledgeSearchInput) => {
    return retrieval.search(input);
  });

  ipc.handle('knowledge:trace', async (_event, input: KnowledgeTraceInput) => {
    return trace.trace(input);
  });

  ipc.handle('knowledge:ingest-episode', async (_event, input: KnowledgeEpisode) => {
    return ingestion.ingestEpisode(input);
  });

  ipc.handle('knowledge:settings:get', async () => getKnowledgeSettings());

  ipc.handle('knowledge:settings:set', async (_event, patch) => setKnowledgeSettings(patch || {}));

  ipc.handle('knowledge:thread-capture:get', async (_event, threadId: string) => ({
    threadId: String(threadId || '').trim(),
    enabled: isThreadKnowledgeCaptureEnabled(threadId)
  }));

  ipc.handle('knowledge:thread-capture:set', async (_event, threadId: string, enabled: boolean) =>
    setThreadKnowledgeCaptureEnabled(threadId, Boolean(enabled))
  );

  ipc.handle('knowledge:stats', async () => store.getStats());

  ipc.handle('knowledge:entities:list', async (_event, limit?: number) => store.listActiveEntities(limit || 100));

  ipc.handle('knowledge:active-tasks:list', async (_event, limit?: number) => taskProcessor.listActiveTasks(limit || 50));
  ipc.handle('knowledge:active-task:finalize', async (_event, taskId: string) => taskProcessor.finalizeTask(String(taskId || '').trim(), 'manual'));
  ipc.handle('knowledge:active-task:discard', async (_event, taskId: string) => ({ discarded: taskProcessor.discardTask(String(taskId || '').trim()) }));

  ipc.handle('knowledge:entity:get', async (_event, entityId: string) => store.getEntityExplorer(entityId));

  ipc.handle('knowledge:claims:list-all', async (_event, options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }) => store.listAllClaims(options || { limit: 20 }));
  ipc.handle('knowledge:patterns:list-all', async (_event, options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }) => store.listAllReflections('pattern', options || { limit: 20 }));
  ipc.handle('knowledge:profiles:list-all', async (_event, options?: { limit?: number; offset?: number; from?: string; to?: string; query?: string }) => store.listAllReflections('profile', options || { limit: 20 }));

  ipc.handle('knowledge:claim:delete', async (_event, claimId: string) => ({ deleted: store.deleteClaim(String(claimId || '').trim()) }));

  ipc.handle('knowledge:reflection:delete', async (_event, reflectionId: string) => ({ deleted: store.deleteReflection(String(reflectionId || '').trim()) }));

  ipc.handle('knowledge:entity:delete', async (_event, entityId: string) => ({ deleted: store.deleteEntity(String(entityId || '').trim()) }));

  ipc.handle('knowledge:dream:run', async (_event, options?: { force?: boolean }) => dream.runDreamCycle(options));

  ipc.handle('knowledge:embedding-models:list', async () => listKnownKnowledgeEmbeddingModels());

  ipc.handle('knowledge:embedding-models:download', async (event, key: string) => {
    return downloadLocalKnowledgeEmbeddingModel(key, (progress) => {
      event.sender.send('knowledge:embedding-models:download-progress', progress);
    });
  });

  ipc.handle('knowledge:embedding-models:open-cache-dir', async (_event, key: string) => {
    const cacheDir = getKnowledgeEmbeddingModelCacheDir(key);
    if (!cacheDir) throw new Error('Unknown or remote embedding model');
    await shell.openPath(cacheDir);
    return { cacheDir };
  });
}
