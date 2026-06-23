import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, extname, resolve } from 'node:path';
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
    if (specifier.startsWith('@shared/')) {
      const sharedPath = resolve(repoRoot, 'src/shared', `${specifier.slice('@shared/'.length)}.ts`);
      return {
        shortCircuit: true,
        url: pathToFileURL(sharedPath).href
      };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier)) {
      const parentPath = context.parentURL?.startsWith('file:')
        ? fileURLToPath(context.parentURL)
        : ''
      if (parentPath.startsWith(repoRoot) && !parentPath.includes('/node_modules/')) {
        return nextResolve(`${specifier}.ts`, context);
      }
    }
    return nextResolve(specifier, context);
  }
});

const { DeterministicKnowledgeClaimExtractor, ModelKnowledgeClaimExtractor } = await import(
  '../../../src/main/knowledge/claim-extractor.ts'
);
const { setSetting } = await import('../../../src/main/db/config-db.ts');

const makeEpisode = (overrides: Partial<any>) => ({
  conversationId: 'c1',
  threadId: 't1',
  agentRunId: null,
  workspacePath: null,
  userText: '',
  assistantText: '',
  toolSummaries: '',
  sourceMessageIds: [],
  createdAt: new Date().toISOString(),
  ...overrides
});

test('DeterministicKnowledgeClaimExtractor extracts keyword claims', async () => {
  const extractor = new DeterministicKnowledgeClaimExtractor();
  const episode = makeEpisode({
    userText: '请记住我平时偏好用 TypeScript，以后请帮我记录这个事实。',
    assistantText: '好的，我已经记下了。',
    workspacePath: '/path/to/PiAgent'
  });

  const claims = await extractor.extractClaims(episode);
  assert.equal(claims.length, 1); // Split by punctuation, which does not split Chinese commas, resulting in 1 clause containing both keywords
  assert.equal(claims[0].entityName, 'PiAgent');
  assert.equal(claims[0].entityType, 'project');
  assert.equal(claims[0].text, '请记住我平时偏好用 TypeScript，以后请帮我记录这个事实');
});

test('ModelKnowledgeClaimExtractor handles structured LLM extraction and fallbacks', async (t) => {
  await t.test('handles success JSON extraction', async () => {
    setSetting('tool_model', 'openai::gpt-4o');

    // Mock runOneShotText
    const mockRunOneShot = async (input: any) => {
      assert.equal(input.modelKeys[0], 'openai::gpt-4o');
      return {
        modelKey: 'openai::gpt-4o',
        text: `
        Some conversational greeting...
        \`\`\`json
        [
          {
            "entityName": "user",
            "entityType": "self",
            "kind": "preference",
            "text": "用户偏好使用 TypeScript 进行 Electron 开发",
            "confidence": 0.95,
            "importance": 0.8,
            "evidenceExcerpt": "偏好用 TypeScript"
          }
        ]
        \`\`\`
        `
      };
    };

    const extractor = new ModelKnowledgeClaimExtractor({ runOneShotText: mockRunOneShot });
    const claims = await extractor.extractClaims(makeEpisode({
      userText: '我偏好用 TypeScript'
    }));

    assert.equal(claims.length, 1);
    assert.equal(claims[0].entityName, 'user');
    assert.equal(claims[0].entityType, 'self');
    assert.equal(claims[0].kind, 'preference');
    assert.equal(claims[0].text, '用户偏好使用 TypeScript 进行 Electron 开发');
    assert.equal(claims[0].confidence, 0.95);
    assert.equal(claims[0].importance, 0.8);
    assert.equal(claims[0].evidenceExcerpt, '偏好用 TypeScript');
  });

  await t.test('falls back to rule extraction on bad json format or error', async () => {
    setSetting('tool_model', 'openai::gpt-4o');

    // Mock runOneShotText to throw an error
    const mockRunOneShot = async () => {
      throw new Error('LLM Error');
    };

    const extractor = new ModelKnowledgeClaimExtractor({ runOneShotText: mockRunOneShot });
    const claims = await extractor.extractClaims(makeEpisode({
      userText: '记住我叫张三'
    }));

    // Shoud fallback to Deterministic extractor and find the claim containing "记住"
    assert.equal(claims.length, 1);
    assert.equal(claims[0].text, '记住我叫张三');
  });
});
