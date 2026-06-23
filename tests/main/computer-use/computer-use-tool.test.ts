import test from 'node:test'
import assert from 'node:assert/strict'
import { ComputerUseService } from '../../../src/main/computer-use/computer-use-service.ts'
import { createComputerUseTool } from '../../../src/main/computer-use/computer-use-tool.ts'
import type { ComputerUseRequest } from '../../../src/main/computer-use/computer-use-types.ts'

type ComputerUseTool = ReturnType<typeof createComputerUseTool>
type ToolExecuteContext = Parameters<ComputerUseTool['execute']>[4]

const executeComputerUseTool = (
  tool: ComputerUseTool,
  params: Record<string, unknown>
): ReturnType<ComputerUseTool['execute']> =>
  tool.execute('tool-computer-use', params, undefined, undefined, {} as ToolExecuteContext)

test('computerUseTool exposes doctor result details', async () => {
  const tool = createComputerUseTool({
    service: {
      async execute(request) {
        assert.equal(request.action, 'doctor')
        return {
          ok: true,
          action: 'doctor',
          observation: {
            doctor: {
              platform: 'darwin',
              available: false,
              stage: 'typescript-shell',
              helper: { available: false, path: null },
              permissions: {
                accessibility: 'denied',
                screenRecording: 'not-determined'
              },
              capabilities: {
                observe: false,
                foregroundInput: false,
                backgroundClick: false
              },
              warnings: ['Native Computer Use helper is not installed yet.']
            }
          },
          warnings: ['Native Computer Use helper is not installed yet.']
        }
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  const result = await executeComputerUseTool(tool, { action: 'doctor' })

  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /doctor completed/)
  const details = result.details as {
    ok: boolean
    observation: { doctor: { stage: string } }
  }
  assert.equal(details.ok, true)
  assert.equal(details.observation.doctor.stage, 'typescript-shell')
})

test('computerUseTool rejects unsupported action names', async () => {
  const tool = createComputerUseTool({
    service: {
      async execute() {
        throw new Error('should not execute')
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  await assert.rejects(
    () => executeComputerUseTool(tool, { action: 'unknown' }),
    /Unsupported Computer Use action/
  )
})

test('computerUseTool explains background operation across input actions', () => {
  const tool = createComputerUseTool({
    service: {
      async execute() {
        throw new Error('not used')
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  assert.match(tool.promptSnippet ?? '', /background operation/i)
  assert.match(tool.promptSnippet ?? '', /type_text/)
  assert.match(tool.promptSnippet ?? '', /press_key/)
  assert.match(tool.promptSnippet ?? '', /open_url/)
  assert.match(tool.promptSnippet ?? '', /raise_window/)
})

test('computerUseTool forwards window snapshot targeting parameters', async () => {
  let captured: ComputerUseRequest | undefined
  const tool = createComputerUseTool({
    service: {
      async execute(request) {
        captured = request
        return {
          ok: true,
          action: request.action,
          observation: {
            pid: request.pid,
            bundle: request.bundle,
            elementId: request.elementId
          }
        }
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  await executeComputerUseTool(tool, {
    action: 'snapshot_window',
    pid: 123,
    bundle: 'com.apple.finder',
    elementId: 'e7',
    url: 'https://example.com'
  })

  assert.equal(captured?.action, 'snapshot_window')
  assert.equal(captured?.pid, 123)
  assert.equal(captured?.bundle, 'com.apple.finder')
  assert.equal(captured?.elementId, 'e7')
  assert.equal(captured?.url, 'https://example.com')
})

test('computerUseTool accepts deterministic extension actions', async () => {
  const captured: ComputerUseRequest[] = []
  const tool = createComputerUseTool({
    service: {
      async execute(request) {
        captured.push(request)
        return {
          ok: true,
          action: request.action,
          actionResult: { accepted: true }
        }
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  await executeComputerUseTool(tool, {
    action: 'set_value',
    pid: 123,
    ref: 'e7',
    value: '商业级输入'
  })
  await executeComputerUseTool(tool, {
    action: 'intent',
    bundle: 'com.microsoft.Word',
    intent: 'launch',
    args: { background: true }
  })

  assert.equal(captured[0]?.action, 'set_value')
  assert.equal(captured[0]?.value, '商业级输入')
  assert.equal(captured[0]?.background, true)
  assert.equal(captured[1]?.action, 'intent')
  assert.equal(captured[1]?.intent, 'launch')
  assert.deepEqual(captured[1]?.args, { background: true })
  assert.equal(captured[1]?.background, true)
})

test('computerUseTool defaults background to true for silent desktop actions unless explicitly set', async () => {
  const captured: ComputerUseRequest[] = []
  const tool = createComputerUseTool({
    service: {
      async execute(request) {
        captured.push(request)
        return {
          ok: true,
          action: request.action
        }
      },
      async doctor() {
        throw new Error('not used')
      }
    }
  })

  await executeComputerUseTool(tool, {
    action: 'click',
    pid: 123,
    x: 10,
    y: 20
  })
  await executeComputerUseTool(tool, {
    action: 'type_text',
    pid: 123,
    text: 'hello'
  })
  await executeComputerUseTool(tool, {
    action: 'open_url',
    bundle: 'com.apple.Safari',
    url: 'https://example.com'
  })
  await executeComputerUseTool(tool, {
    action: 'click',
    pid: 123,
    x: 10,
    y: 20,
    background: false
  })
  await executeComputerUseTool(tool, {
    action: 'screenshot'
  })

  assert.equal(captured[0]?.background, true)
  assert.equal(captured[1]?.background, true)
  assert.equal(captured[2]?.background, true)
  assert.equal(captured[3]?.background, false)
  assert.equal(captured[4]?.background, undefined)
})

test('ComputerUseService maps window observation helper results', async () => {
  const service = new ComputerUseService({
    async request(action) {
      assert.equal(action, 'snapshot_window')
      return {
        pid: 123,
        window: { windowId: 456 },
        accessibilityTree: { ref: 'e1' },
        screenshot: { mimeType: 'image/png', dataBase64: 'abc' }
      }
    }
  } as unknown as ConstructorParameters<typeof ComputerUseService>[0])

  const result = await service.execute({
    action: 'snapshot_window',
    pid: 123
  })

  assert.equal(result.ok, true)
  assert.equal(result.action, 'snapshot_window')
  const observation = result.observation as {
    pid: number
    window: { windowId: number }
    accessibilityTree: { ref: string }
  }
  assert.equal(observation.pid, 123)
  assert.equal(observation.window.windowId, 456)
  assert.equal(observation.accessibilityTree.ref, 'e1')
})

test('ComputerUseService normalizes snapshot_window into flat elements', async () => {
  const service = new ComputerUseService({
    async request(action) {
      assert.equal(action, 'snapshot_window')
      return {
        pid: 123,
        window: { windowId: 456 },
        accessibilityTree: {
          ref: 'e1',
          role: 'AXApplication',
          title: 'Root',
          children: [
            {
              ref: 'e2',
              role: 'AXButton',
              title: '保存',
              actions: ['AXPress']
            }
          ]
        },
        screenshot: { mimeType: 'image/png', path: '/tmp/snap.png', width: 100, height: 80 }
      }
    }
  } as unknown as ConstructorParameters<typeof ComputerUseService>[0])

  const result = await service.execute({
    action: 'snapshot_window',
    pid: 123
  })

  const observation = result.observation as {
    snapshotId: string
    elements: Array<Record<string, unknown>>
  }
  assert.match(observation.snapshotId, /^snap-/)
  assert.deepEqual(
    observation.elements.map((item) => [item.ref, item.role, item.title]),
    [
      ['e1', 'AXApplication', 'Root'],
      ['e2', 'AXButton', '保存']
    ]
  )
  assert.equal('children' in observation.elements[0], false)
})

test('ComputerUseService attaches post-action screenshot when target is available', async () => {
  const calls: Array<{ action: string; params: ComputerUseRequest }> = []
  const service = new ComputerUseService({
    async request(action, params) {
      calls.push({ action, params })
      if (action === 'click') {
        return {
          performed: true,
          method: 'background_cg_event',
          target: { pid: 123, windowId: 456 }
        }
      }
      if (action === 'capture_window') {
        return {
          mimeType: 'image/png',
          path: '/tmp/piagent-computer-use/window-456.png',
          width: 320,
          height: 200,
          dataBase64: 'removed'
        }
      }
      throw new Error(`unexpected action ${action}`)
    }
  } as unknown as ConstructorParameters<typeof ComputerUseService>[0])

  const result = await service.execute({
    action: 'click',
    pid: 123,
    windowId: 456,
    x: 10,
    y: 20,
    background: true
  })

  assert.deepEqual(
    calls.map((call) => call.action),
    ['click', 'capture_window']
  )
  const actionResult = result.actionResult as {
    postActionScreenshot: Record<string, unknown>
  }
  assert.equal(actionResult.postActionScreenshot.path, '/tmp/piagent-computer-use/window-456.png')
  assert.equal('dataBase64' in actionResult.postActionScreenshot, false)
})

test('ComputerUseService keeps screenshot observations path-based', async () => {
  const service = new ComputerUseService({
    async request(action) {
      assert.equal(action, 'screenshot')
      return {
        mimeType: 'image/png',
        path: '/tmp/piagent-computer-use/screen-1.png',
        dataBase64: 'large-inline-payload',
        width: 100,
        height: 80
      }
    }
  } as unknown as ConstructorParameters<typeof ComputerUseService>[0])

  const result = await service.execute({ action: 'screenshot' })
  const screenshot = result.observation?.screenshot as Record<string, unknown>

  assert.equal(screenshot.path, '/tmp/piagent-computer-use/screen-1.png')
  assert.equal(screenshot.mimeType, 'image/png')
  assert.equal(screenshot.width, 100)
  assert.equal(screenshot.height, 80)
  assert.equal('dataBase64' in screenshot, false)
})
