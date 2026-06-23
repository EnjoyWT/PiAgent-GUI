import test from 'node:test'
import assert from 'node:assert/strict'

import { buildComputerUseSetupReport } from '../../../src/shared/computer-use-settings.ts'
import type { ComputerUseDoctorResult } from '../../../src/main/computer-use/computer-use-types.ts'

const baseDoctor = (overrides: Partial<ComputerUseDoctorResult> = {}): ComputerUseDoctorResult => ({
  platform: 'darwin',
  available: false,
  stage: 'native-helper',
  helper: {
    available: true,
    path: '/Applications/PiAgent.app/Contents/Resources/computer-use-helper/mac/PiAgent Computer Use.app/Contents/MacOS/PiAgentComputerUseHelper'
  },
  permissions: {
    accessibility: 'denied',
    screenRecording: 'granted'
  },
  capabilities: {
    observe: true,
    foregroundInput: false,
    backgroundClick: false,
    backgroundKeyboard: false,
    backgroundDrag: false,
    backgroundScroll: false,
    windowLocalBackgroundClick: false,
    privateSymbols: {
      cgEventPostToPid: true,
      cgEventSetWindowLocation: true
    }
  },
  warnings: ['Accessibility permission is not granted.'],
  ...overrides
})

test('buildComputerUseSetupReport requires helper, permissions, and private symbols', () => {
  const report = buildComputerUseSetupReport(baseDoctor())

  assert.equal(report.ready, false)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(
    report.checks.map((item) => [item.id, item.ok]),
    [
      ['helper', true],
      ['accessibility', false],
      ['screenRecording', true],
      ['cgEventPostToPid', true],
      ['cgEventSetWindowLocation', true],
      ['backgroundClick', false],
      ['backgroundKeyboard', false],
      ['backgroundDrag', false],
      ['backgroundScroll', false]
    ]
  )
  assert.match(report.summary, /辅助功能权限/)
})

test('buildComputerUseSetupReport marks setup ready when background click prerequisites are ready', () => {
  const report = buildComputerUseSetupReport(
    baseDoctor({
      available: true,
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
    })
  )

  assert.equal(report.ready, true)
  assert.equal(report.status, 'ready')
  assert.equal(report.summary, 'Computer Use 已就绪，可执行窗口观察、静默点击和后台输入。')
})
