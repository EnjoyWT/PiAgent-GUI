import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRuntimeToolRegistry } from '../../../src/main/runtime-host/runtime-tool-layer/runtime-tool-registry.ts'
import { resolveRuntimeTools } from '../../../src/main/runtime-host/runtime-tool-layer/runtime-tool-resolver.ts'

const createTool = (name: string, description = name) =>
  ({
    name,
    label: name,
    description,
    parameters: {
      type: 'object',
      properties: {}
    }
  }) as any

test('runtime tool resolver blocks local-only tools on IM surfaces while keeping shared tools active', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'framework',
      tools: [createTool('discoverBuiltinToolsTool', 'Discover tools')],
      scopes: ['local', 'im']
    },
    {
      source: 'builtin',
      tools: [createTool('read', 'Read files')],
      scopes: ['local', 'im']
    },
    {
      source: 'interaction',
      tools: [createTool('questionTool', 'Ask a blocking question')],
      scopes: ['local']
    },
    {
      source: 'surface',
      tools: [
        createTool('imTool', 'IM operations'),
        createTool('providerConfigTool', 'Provider setup'),
        createTool('widgetRenderer', 'Inline widgets'),
        createTool('computerUseTool', 'Computer Use'),
        createTool('computerSystemInfoTool', 'Computer System Info')
      ],
      scopes: ['im']
    }
  ])

  const resolution = resolveRuntimeTools(registry, {
    surface: 'im'
  })

  assert.deepEqual(
    resolution.activeToolNames,
    ['discoverBuiltinToolsTool', 'read'].filter((name) =>
      resolution.entries.some((entry) => entry.name === name)
    )
  )
  assert.equal(resolution.entries.find((entry) => entry.name === 'imTool')?.status, 'discoverable')
  assert.equal(resolution.entries.find((entry) => entry.name === 'questionTool')?.status, 'blocked')
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'providerConfigTool')?.status,
    'blocked'
  )
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'widgetRenderer')?.blockedReason,
    'Unavailable on the im runtime surface.'
  )
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'computerUseTool')?.status,
    'blocked'
  )
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'computerUseTool')?.blockedReason,
    'Unavailable on the im runtime surface.'
  )
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'computerSystemInfoTool')?.status,
    'blocked'
  )
  assert.equal(
    resolution.entries.find((entry) => entry.name === 'computerSystemInfoTool')?.blockedReason,
    'Unavailable on the im runtime surface.'
  )
})

test('runtime tool resolver classifies computerUseTool as local-only computer_use toolset', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'framework',
      tools: [createTool('computerUseTool', 'Computer Use')],
      scopes: ['local', 'im']
    }
  ])

  const localResolution = resolveRuntimeTools(registry, {
    surface: 'local'
  })
  const minimalResolution = resolveRuntimeTools(registry, {
    surface: 'local',
    toolProfileId: 'minimal'
  })

  assert.deepEqual(
    localResolution.entries.find((entry) => entry.name === 'computerUseTool')?.toolsets,
    ['computer_use']
  )
  assert.equal(
    localResolution.entries.find((entry) => entry.name === 'computerUseTool')?.status,
    'discoverable'
  )
  assert.equal(
    minimalResolution.entries.find((entry) => entry.name === 'computerUseTool')?.status,
    'discoverable'
  )
})

test('runtime tool resolver classifies WebFetch tools under the web toolset', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'framework',
      tools: [
        createTool('webSearchTool', 'Search Google through WebFetch'),
        createTool('webFetchTool', 'Fetch web pages through WebFetch')
      ],
      scopes: ['local', 'im']
    }
  ])

  const resolution = resolveRuntimeTools(registry, {
    surface: 'local'
  })

  assert.deepEqual(resolution.entries.find((entry) => entry.name === 'webSearchTool')?.toolsets, [
    'web'
  ])
  assert.deepEqual(resolution.entries.find((entry) => entry.name === 'webFetchTool')?.toolsets, [
    'web'
  ])
  assert.equal(resolution.enabledToolsets.includes('web'), true)
})

test('runtime tool resolver classifies computerSystemInfoTool as local-only system_info toolset', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'framework',
      tools: [createTool('computerSystemInfoTool', 'Computer System Info')],
      scopes: ['local', 'im']
    }
  ])

  const localResolution = resolveRuntimeTools(registry, {
    surface: 'local'
  })
  const minimalResolution = resolveRuntimeTools(registry, {
    surface: 'local',
    toolProfileId: 'minimal'
  })

  assert.deepEqual(
    localResolution.entries.find((entry) => entry.name === 'computerSystemInfoTool')?.toolsets,
    ['system_info']
  )
  assert.equal(
    localResolution.entries.find((entry) => entry.name === 'computerSystemInfoTool')?.status,
    'discoverable'
  )
  assert.equal(
    minimalResolution.entries.find((entry) => entry.name === 'computerSystemInfoTool')?.status,
    'discoverable'
  )
})

test('runtime tool registry classifies plugin tools under the plugin source and toolset', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'plugin',
      tools: [createTool('plugin__agent_pack__echo', 'Echo from agent plugin')],
      scopes: ['local', 'im']
    }
  ])

  const entry = registry.find((item) => item.name === 'plugin__agent_pack__echo')
  assert.equal(entry?.source, 'plugin')
  assert.equal(entry?.builtin, false)
  assert.deepEqual(entry?.toolsets, ['plugin'])
  assert.deepEqual(entry?.scopes, ['im', 'local'])
})

test('default local resolution exposes only core tools and capability meta-tools', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'builtin',
      tools: [
        createTool('read', 'Read files'),
        createTool('bash', 'Run commands'),
        createTool('edit', 'Edit files'),
        createTool('write', 'Write files'),
        createTool('find', 'Find files'),
        createTool('grep', 'Search files'),
        createTool('ls', 'List files')
      ],
      scopes: ['local', 'im']
    },
    {
      source: 'framework',
      tools: [
        createTool('capabilitySearch', 'Discover runtime capabilities'),
        createTool('capabilityActivate', 'Activate runtime capabilities'),
        createTool('skillSearch', 'Search available Skills'),
        createTool('readSkillTool', 'Read a Skill'),
        createTool('webSearchTool', 'Search the web')
      ],
      scopes: ['local', 'im']
    }
  ])

  const resolution = resolveRuntimeTools(registry, { surface: 'local', toolProfileId: 'default' })

  assert.deepEqual(resolution.activeToolNames, [
    'bash',
    'capabilityActivate',
    'capabilitySearch',
    'edit',
    'find',
    'grep',
    'ls',
    'read',
    'readSkillTool',
    'skillSearch',
    'write'
  ])
  assert.equal(resolution.entries.find((entry) => entry.name === 'webSearchTool')?.status, 'discoverable')
})

test('resolver preserves core tools when it receives cached active names', () => {
  const registry = buildRuntimeToolRegistry([
    {
      source: 'builtin',
      tools: [createTool('read', 'Read files'), createTool('bash', 'Run commands')],
      scopes: ['local', 'im']
    },
    {
      source: 'framework',
      tools: [
        createTool('capabilitySearch', 'Discover runtime capabilities'),
        createTool('capabilityActivate', 'Activate runtime capabilities'),
        createTool('skillSearch', 'Search available Skills'),
        createTool('readSkillTool', 'Read a Skill'),
        createTool('webSearchTool', 'Search the web')
      ],
      scopes: ['local', 'im']
    }
  ])

  const resolution = resolveRuntimeTools(registry, {
    surface: 'local',
    activeToolNames: ['webSearchTool']
  })

  assert.deepEqual(resolution.activeToolNames, [
    'bash',
    'capabilityActivate',
    'capabilitySearch',
    'read',
    'readSkillTool',
    'skillSearch',
    'webSearchTool'
  ])
})
