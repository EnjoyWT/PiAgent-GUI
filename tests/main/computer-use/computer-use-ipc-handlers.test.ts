import test from 'node:test'
import assert from 'node:assert/strict'

import { createComputerUseIpcHandlers } from '../../../src/main/ipc/computer-use-handlers.ts'
import type {
  ComputerUseDoctorResult,
  ComputerUseResult
} from '../../../src/main/computer-use/computer-use-types.ts'

const readyDoctor: ComputerUseDoctorResult = {
  platform: 'darwin',
  available: true,
  stage: 'native-helper',
  helper: {
    available: true,
    path: '/tmp/PiAgent Computer Use.app/Contents/MacOS/PiAgentComputerUseHelper'
  },
  permissions: {
    accessibility: 'granted',
    screenRecording: 'granted'
  },
  capabilities: {
    observe: true,
    foregroundInput: true,
    backgroundClick: true,
    backgroundKeyboard: true,
    backgroundDrag: true,
    backgroundScroll: true,
    windowLocalBackgroundClick: true,
    privateSymbols: {
      cgEventPostToPid: true,
      cgEventSetWindowLocation: true
    }
  },
  warnings: []
}

test('createComputerUseIpcHandlers exposes doctor, permission request, and setup report', async () => {
  const calls: string[] = []
  const handlers = createComputerUseIpcHandlers({
    async doctor() {
      calls.push('doctor')
      return readyDoctor
    },
    async execute(request) {
      calls.push(`${request.action}:${request.timeoutMs}`)
      return {
        ok: true,
        action: request.action,
        actionResult: {
          requested: true
        }
      } satisfies ComputerUseResult
    }
  })

  assert.equal(await handlers.doctor(), readyDoctor)
  assert.deepEqual(await handlers.requestPermissions(12_000), { requested: true })

  const report = await handlers.testSetup()
  assert.equal(report.ready, true)
  assert.equal(report.checks.find((item) => item.id === 'backgroundClick')?.ok, true)
  assert.deepEqual(calls, ['doctor', 'request_permissions:12000', 'doctor'])
})
