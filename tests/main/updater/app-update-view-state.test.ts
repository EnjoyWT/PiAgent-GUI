import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAppUpdatePrimaryControl,
  buildAppUpdateSidebarBadge,
  type AppUpdateStatus
} from '../../../src/shared/app-update.ts'

const status = (patch: Partial<AppUpdateStatus>): AppUpdateStatus => ({
  phase: 'idle',
  currentVersion: '0.0.1',
  isPackaged: true,
  supported: true,
  updateInfo: null,
  progress: null,
  error: null,
  releasePageUrl: 'https://github.com/EnjoyWT/PiAgent-GUI/releases',
  checkedAt: null,
  ...patch
})

test('primary update control downloads available in-app updates', () => {
  const control = buildAppUpdatePrimaryControl(
    status({
      phase: 'available',
      updateInfo: {
        version: '1.2.3',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null
      }
    })
  )

  assert.equal(control.action, 'download')
  assert.equal(control.label, '下载 v1.2.3')
  assert.equal(control.disabled, false)
  assert.equal(control.progressPercent, null)
})

test('primary update control keeps downloading as a disabled async state with progress', () => {
  const control = buildAppUpdatePrimaryControl(
    status({
      phase: 'downloading',
      progress: {
        percent: 42.7,
        bytesPerSecond: 0,
        transferred: 427,
        total: 1000
      },
      updateInfo: {
        version: '1.2.3',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null
      }
    })
  )

  assert.equal(control.action, 'none')
  assert.equal(control.label, '下载中 42%')
  assert.equal(control.disabled, true)
  assert.equal(control.progressPercent, 42.7)
})

test('primary update control installs downloaded updates', () => {
  const control = buildAppUpdatePrimaryControl(
    status({
      phase: 'downloaded',
      updateInfo: {
        version: '1.2.3',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null
      }
    })
  )

  assert.equal(control.action, 'install')
  assert.equal(control.label, '重启安装')
  assert.equal(control.disabled, false)
  assert.equal(control.progressPercent, 100)
})

test('primary update control opens release page when in-app update is unavailable', () => {
  const control = buildAppUpdatePrimaryControl(
    status({
      phase: 'available',
      isPackaged: false,
      updateInfo: {
        version: '1.2.3',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null
      }
    })
  )

  assert.equal(control.action, 'open-release')
  assert.equal(control.label, '打开 Release')
  assert.equal(control.disabled, false)
})

test('primary update control retries a failed download when an update is known', () => {
  const control = buildAppUpdatePrimaryControl(
    status({
      phase: 'error',
      error: '下载失败',
      updateInfo: {
        version: '1.2.3',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null
      }
    })
  )

  assert.equal(control.action, 'download')
  assert.equal(control.label, '重试下载')
  assert.equal(control.disabled, false)
})

test('sidebar update badge reflects resumable global updater states', () => {
  assert.deepEqual(
    buildAppUpdateSidebarBadge(
      status({
        phase: 'available',
        updateInfo: {
          version: '1.2.3',
          releaseName: null,
          releaseNotes: null,
          releaseDate: null
        }
      })
    ),
    {
      label: '更新',
      tone: 'available',
      progressPercent: null
    }
  )

  assert.deepEqual(
    buildAppUpdateSidebarBadge(
      status({
        phase: 'downloading',
        progress: {
          percent: 42.7,
          bytesPerSecond: 0,
          transferred: 427,
          total: 1000
        }
      })
    ),
    {
      label: '下载 42%',
      tone: 'downloading',
      progressPercent: 42.7
    }
  )

  assert.deepEqual(buildAppUpdateSidebarBadge(status({ phase: 'downloaded' })), {
    label: '可安装',
    tone: 'downloaded',
    progressPercent: 100
  })

  assert.equal(buildAppUpdateSidebarBadge(status({ phase: 'not-available' })), null)
})
