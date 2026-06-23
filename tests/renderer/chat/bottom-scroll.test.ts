import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createBottomScrollAnimation,
  getBottomScrollDuration,
  getBottomScrollFrame
} from '../../../src/renderer/src/components/layout/bottom-scroll.ts'

test('bottom scroll duration scales with distance and stays bounded', () => {
  assert.equal(getBottomScrollDuration(0), 0)
  assert.equal(getBottomScrollDuration(40), 140)
  assert.ok(getBottomScrollDuration(360) > getBottomScrollDuration(40))
  assert.equal(getBottomScrollDuration(2000), 320)
})

test('bottom scroll animation eases from current top to target top', () => {
  const animation = createBottomScrollAnimation({
    startTop: 100,
    targetTop: 300,
    startedAt: 1000
  })

  const first = getBottomScrollFrame(animation, 1000)
  const middle = getBottomScrollFrame(animation, 1080)
  const last = getBottomScrollFrame(animation, 1400)

  assert.equal(first.top, 100)
  assert.equal(first.done, false)
  assert.ok(middle.top > 100)
  assert.ok(middle.top < 300)
  assert.equal(last.top, 300)
  assert.equal(last.done, true)
})

test('bottom scroll animation retargets without jumping backwards', () => {
  const animation = createBottomScrollAnimation({
    startTop: 100,
    targetTop: 260,
    startedAt: 0
  })

  const beforeRetarget = getBottomScrollFrame(animation, 80).top
  const retargeted = createBottomScrollAnimation({
    startTop: beforeRetarget,
    targetTop: 420,
    startedAt: 80
  })
  const afterRetarget = getBottomScrollFrame(retargeted, 96)

  assert.ok(afterRetarget.top >= beforeRetarget)
  assert.ok(afterRetarget.top < 420)
})
