import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return {
        shortCircuit: true,
        url: pathToFileURL(resolve(repoRoot, 'tests/main/runtime-host/electron-stub.mjs')).href
      };
    }
    return nextResolve(specifier, context);
  }
});

const { OnnxEmbeddingEngine } = await import('../../../src/main/knowledge/embedding/onnx-embedding-engine.ts');

// Mock the model catalog and transformers
test('OnnxEmbeddingEngine pipeline loading, prefix handling and inference parsing', async (t) => {
  await t.test('prefixed inputs are constructed correctly', async () => {
    const engine = new OnnxEmbeddingEngine('BAAI/bge-small-zh-v1.5');
    
    // Access private buildInput for testing prefixing
    const buildInput = (engine as any).buildInput.bind(engine);

    // BGE ZH query has prefix
    assert.equal(
      buildInput('你好', 'query'),
      '为这个句子生成表示以用于检索相关段落：你好'
    );

    // BGE ZH passage has NO prefix
    assert.equal(
      buildInput('你好', 'passage'),
      '你好'
    );

    const enEngine = new OnnxEmbeddingEngine('BAAI/bge-small-en-v1.5');
    const buildInputEn = (enEngine as any).buildInput.bind(enEngine);

    // BGE EN query has prefix
    assert.equal(
      buildInputEn('hello', 'query'),
      'Represent this sentence for searching relevant passages: hello'
    );

    // BGE EN passage has NO prefix
    assert.equal(
      buildInputEn('hello', 'passage'),
      'hello'
    );
  });

  await t.test('cosineSimilarity computes dot product correctly', () => {
    const engine = new OnnxEmbeddingEngine();
    
    // Exact match
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    assert.equal(engine.cosineSimilarity(a, b), 1);

    // Orthogonal
    const c = new Float32Array([0, 1, 0]);
    assert.equal(engine.cosineSimilarity(a, c), 0);

    // Opposite
    const d = new Float32Array([-1, 0, 0]);
    assert.equal(engine.cosineSimilarity(a, d), -1);

    // Normal values
    const x = new Float32Array([0.6, 0.8]);
    const y = new Float32Array([0.8, 0.6]);
    // 0.6*0.8 + 0.8*0.6 = 0.48 + 0.48 = 0.96
    assert.ok(Math.abs(engine.cosineSimilarity(x, y) - 0.96) < 1e-5);
  });

  await t.test('dtype is selected from available local ONNX artifacts', () => {
    const fp32Dir = mkdtempSync(join(tmpdir(), 'piagent-embedding-fp32-'));
    mkdirSync(join(fp32Dir, 'onnx'), { recursive: true });
    writeFileSync(join(fp32Dir, 'onnx', 'model.onnx'), 'mock');

    const q8Dir = mkdtempSync(join(tmpdir(), 'piagent-embedding-q8-'));
    mkdirSync(join(q8Dir, 'onnx'), { recursive: true });
    writeFileSync(join(q8Dir, 'onnx', 'model_quantized.onnx'), 'mock');

    const engine = new OnnxEmbeddingEngine();
    assert.equal((engine as any).detectDtype(fp32Dir), 'fp32');
    assert.equal((engine as any).detectDtype(q8Dir), 'q8');
  });

  await t.test('single and batch inference correctly parses tensor structure', async () => {
    const engine = new OnnxEmbeddingEngine('BAAI/bge-small-zh-v1.5');
    
    // Stub the catalog and dynamic import of transformers
    (engine as any).loadPipeline = async () => {
      // Mocked pipeline function
      const pipelineMock: any = async (inputs: string | string[]) => {
        if (typeof inputs === 'string') {
          return {
            data: new Float32Array(Array(384).fill(0.5)),
            dims: [1, 384]
          };
        } else {
          const size = inputs.length;
          return {
            data: new Float32Array(Array(size * 384).fill(0.8)),
            dims: [size, 384]
          };
        }
      };
      pipelineMock.dispose = async () => {};
      return pipelineMock;
    };

    // Test single embed
    const single = await engine.embed('test query', 'query');
    assert.equal(single.length, 384);
    assert.ok(Math.abs(single[0] - 0.5) < 1e-5);

    // Test batch embed
    const batch = await engine.embedBatch(['doc 1', 'doc 2'], 'passage');
    assert.equal(batch.length, 2);
    assert.equal(batch[0].length, 384);
    assert.ok(Math.abs(batch[0][0] - 0.8) < 1e-5);
    assert.equal(batch[1].length, 384);
    assert.ok(Math.abs(batch[1][0] - 0.8) < 1e-5);

    engine.dispose();
  });
});
