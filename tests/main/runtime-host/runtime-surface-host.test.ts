import test from 'node:test'
import assert from 'node:assert/strict'
import { RuntimeSurfaceHost } from '../../../src/main/runtime-host/runtime-surface/runtime-surface-host.ts'

test('local runtime surface returns desktop-specific surface tools', async () => {
  const host = new RuntimeSurfaceHost()
  const surface = await host.getSurface('local')
  const tools = await surface.getCustomTools({
    conversationId: 'conversation-local',
    interactionThreadId: 'thread-local',
    getActiveRunId: () => null,
    interactionController: {
      createTools: () => [
        { name: 'questionTool' } as any,
        { name: 'questionnaireTool' } as any,
        { name: 'secretRequestTool' } as any
      ]
    } as any
  })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'providerConfigTool',
      'scheduledTaskTool',
      'imTool',
      'computerSystemInfoTool',
      'systemDoctorTool',
      'widgetRenderer'
    ]
  )
})

test('im runtime surface keeps prompt transport-safe while exposing doctor and automation tools', async () => {
  const host = new RuntimeSurfaceHost()
  const surface = await host.getSurface('im')
  const tools = await surface.getCustomTools({
    conversationId: 'conversation-im',
    interactionThreadId: 'thread-im',
    getActiveRunId: () => null,
    interactionController: {
      createTools: () => [{ name: 'questionTool' } as any]
    } as any
  })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['scheduledTaskTool', 'imTool', 'systemDoctorTool']
  )

  const prompt = surface.buildSystemPrompt({
    workspacePath: '/tmp/workspace',
    threadId: 'thread-im',
    appConfigDir: '/tmp/piagent-config'
  })
  assert.match(prompt, /discoverBuiltinToolsTool/)
  assert.match(prompt, /runtime preloads the active tool set/i)
  assert.match(prompt, /non-desktop transport/i)
  assert.match(prompt, /imTool/)
  assert.match(prompt, /systemDoctorTool/)
  assert.match(prompt, /domain `transport`/)
  assert.doesNotMatch(prompt, /questionTool/)
  assert.doesNotMatch(prompt, /widgetRenderer/)
})
