import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getKnownKnowledgeEmbeddingModel } from './embedding-catalog.ts';

export interface EmbeddingEngine {
  /** 初始化模型（lazy，首次调用时加载） */
  initialize(): Promise<void>

  /** 单条文本 → embedding */
  embed(text: string, mode?: 'query' | 'passage'): Promise<Float32Array>

  /** 批量文本 → embeddings */
  embedBatch(texts: string[], mode?: 'query' | 'passage'): Promise<Float32Array[]>

  /** 计算两个 embedding 的 cosine similarity */
  cosineSimilarity(a: Float32Array, b: Float32Array): number

  /** 释放模型资源 */
  dispose(): void
}

type LocalEmbeddingTensor = {
  data: ArrayLike<number>
  dims: number[]
}

type LocalEmbeddingPipeline = ((
  input: string | string[],
  options?: {
    pooling?: 'mean'
    normalize?: boolean
  }
) => Promise<LocalEmbeddingTensor>) & {
  dispose?: () => Promise<void>
}

type TransformerDtype = 'q8' | 'fp32'

export class OnnxEmbeddingEngine implements EmbeddingEngine {
  private pipelinePromise: Promise<LocalEmbeddingPipeline> | null = null;
  private pipeline: LocalEmbeddingPipeline | null = null;
  private readonly modelKey: string;

  constructor(modelKey: string = 'BAAI/bge-small-zh-v1.5') {
    this.modelKey = modelKey;
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return;
    if (this.pipelinePromise) {
      await this.pipelinePromise;
      return;
    }

    this.pipelinePromise = this.loadPipeline();
    try {
      this.pipeline = await this.pipelinePromise;
    } catch (error) {
      this.pipelinePromise = null;
      throw error;
    }
  }

  private async loadPipeline(): Promise<LocalEmbeddingPipeline> {
    const knownModel = getKnownKnowledgeEmbeddingModel(this.modelKey);
    if (!knownModel) {
      throw new Error(`未找到嵌入模型配置：${this.modelKey}`);
    }

    if (knownModel.sourceType !== 'local') {
      throw new Error(`当前模型不是本地嵌入模型：${this.modelKey}`);
    }

    if (!knownModel.downloaded || !knownModel.cacheDir) {
      throw new Error(`本地嵌入模型尚未下载：${this.modelKey}`);
    }

    const transformers = (await import('@huggingface/transformers')) as any;
    
    // 配置 transformers 环境，避免拉取外网
    transformers.env.localFilesOnly = true;

    const extractor = (await transformers.pipeline('feature-extraction', knownModel.cacheDir, {
      local_files_only: true,
      dtype: this.detectDtype(knownModel.cacheDir)
    })) as LocalEmbeddingPipeline;

    return extractor;
  }

  private detectDtype(cacheDir: string): TransformerDtype {
    const quantizedModel = join(cacheDir, 'onnx', 'model_quantized.onnx');
    return existsSync(quantizedModel) ? 'q8' : 'fp32';
  }

  private buildInput(text: string, mode: 'query' | 'passage'): string {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';

    // BGE 中文模型生成 query 时需要特定前缀以达到最佳效果
    if (this.modelKey.includes('bge-small-zh') && mode === 'query') {
      return `为这个句子生成表示以用于检索相关段落：${trimmed}`;
    }
    // BGE 英文模型
    if (this.modelKey.includes('bge-small-en') && mode === 'query') {
      return `Represent this sentence for searching relevant passages: ${trimmed}`;
    }

    return trimmed;
  }

  async embed(text: string, mode: 'query' | 'passage' = 'passage'): Promise<Float32Array> {
    await this.initialize();
    if (!this.pipeline) throw new Error('Embedding engine is not initialized');

    const input = this.buildInput(text, mode);
    if (!input) return new Float32Array(384);

    const tensor = await this.pipeline(input, {
      pooling: 'mean',
      normalize: true
    });

    const data = Array.from(tensor.data, (item) => Number(item));
    return new Float32Array(data);
  }

  async embedBatch(texts: string[], mode: 'query' | 'passage' = 'passage'): Promise<Float32Array[]> {
    await this.initialize();
    if (!this.pipeline) throw new Error('Embedding engine is not initialized');

    const inputs = texts.map(t => this.buildInput(t, mode));
    if (inputs.length === 0) return [];

    const tensor = await this.pipeline(inputs, {
      pooling: 'mean',
      normalize: true
    });

    // 转换为 Float32Array[]
    const dims = Array.isArray(tensor.dims) ? tensor.dims : [];
    const data = Array.from(tensor.data, (item) => Number(item));

    if (dims.length <= 1) {
      return [new Float32Array(data)];
    }

    const expectedCount = inputs.length;
    const leading = Number(dims[0] ?? expectedCount);
    const width = dims.length >= 2 
      ? Number(dims.slice(1).reduce((product, item) => product * Math.max(1, Number(item)), 1))
      : Math.floor(data.length / Math.max(1, expectedCount));

    const safeWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
    const count = Number.isFinite(leading) && leading > 0 ? Math.min(expectedCount, Math.floor(leading)) : 0;

    if (safeWidth <= 0 || count <= 0) {
      return inputs.map(() => new Float32Array(384));
    }

    const results: Float32Array[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = index * safeWidth;
      const end = start + safeWidth;
      results.push(new Float32Array(data.slice(start, end)));
    }

    return results;
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length === 0 || a.length !== b.length) return 0;

    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  dispose(): void {
    if (this.pipeline && typeof this.pipeline.dispose === 'function') {
      this.pipeline.dispose().catch(() => {});
    }
    this.pipeline = null;
    this.pipelinePromise = null;
  }
}
