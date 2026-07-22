import test from 'node:test'
import assert from 'node:assert/strict'

import { toUserFacingUpdateError } from '../../../src/shared/app-update.ts'

test('toUserFacingUpdateError returns friendly message for missing GitHub release', () => {
  const raw = `Error: Unable to find latest version on GitHub (https://github.com/EnjoyWT/PiAgent-GUI/releases/latest), please ensure a production release exists: HttpError: 406 "method: GET url: https://github.com/EnjoyWT/PiAgent-GUI/releases"`
  const result = toUserFacingUpdateError(raw)
  assert.equal(result, '暂时找不到可用的正式版本，请稍后重试，或前往 GitHub Release 手动下载。')
})

test('toUserFacingUpdateError returns friendly message for network errors', () => {
  const err = new Error('request failed: connect ETIMEDOUT 192.168.1.1:443')
  const result = toUserFacingUpdateError(err)
  assert.equal(result, '无法连接更新服务，请检查网络后重试。')
})

test('toUserFacingUpdateError returns friendly message for ENOTFOUND', () => {
  const err = new Error('getaddrinfo ENOTFOUND api.github.com')
  const result = toUserFacingUpdateError(err)
  assert.equal(result, '无法连接更新服务，请检查网络后重试。')
})

test('toUserFacingUpdateError returns friendly message for latest-mac.yml missing', () => {
  const raw = 'Cannot find latest-mac.yml in the release'
  const result = toUserFacingUpdateError(raw)
  assert.equal(result, '更新文件尚未准备完成，请稍后重试，或前往 GitHub Release 手动下载。')
})

test('toUserFacingUpdateError returns default for unknown errors', () => {
  const err = new Error('something weird happened')
  const result = toUserFacingUpdateError(err)
  assert.equal(result, '检查更新时发生错误，请稍后重试，或前往 GitHub Release 手动下载。')
})

test('toUserFacingUpdateError handles non-Error input', () => {
  const result = toUserFacingUpdateError(null)
  assert.equal(result, '检查更新时发生错误，请稍后重试，或前往 GitHub Release 手动下载。')
})

test('toUserFacingUpdateError handles string input', () => {
  const result = toUserFacingUpdateError('unknown error')
  assert.equal(result, '检查更新时发生错误，请稍后重试，或前往 GitHub Release 手动下载。')
})
