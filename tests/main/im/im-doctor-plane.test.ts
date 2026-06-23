import test from 'node:test'
import assert from 'node:assert/strict'
import { ImDoctorPlane } from '../../../src/main/im/im-doctor-plane.ts'

test('IM doctor plane records ordered trace steps and resolves aggregate status', () => {
  const plane = new ImDoctorPlane()

  plane.recordStep({
    imTraceId: 'trace-a',
    componentId: 'trace:trace-a',
    step: 'transport_received',
    status: 'pass',
    message: 'received'
  })
  plane.recordStep({
    imTraceId: 'trace-a',
    componentId: 'trace:trace-a',
    step: 'identity_resolved',
    status: 'warn',
    message: 'identity degraded',
    detail: { reason: 'missing union id' }
  })

  const trace = plane.getTrace('trace-a')

  assert.equal(trace?.imTraceId, 'trace-a')
  assert.equal(trace?.status, 'warn')
  assert.equal(trace?.steps.length, 2)
  assert.equal(trace?.steps[0]?.step, 'transport_received')
  assert.equal(trace?.steps[1]?.step, 'identity_resolved')
  assert.deepEqual(trace?.steps[1]?.detail, { reason: 'missing union id' })
})

test('IM doctor plane lists newest traces first and bounds history', () => {
  const plane = new ImDoctorPlane({ maxEvents: 3 })

  plane.recordStep({
    imTraceId: 'trace-old',
    componentId: 'trace:trace-old',
    step: 'transport_received',
    status: 'pass',
    message: 'old'
  })
  plane.recordStep({
    imTraceId: 'trace-a',
    componentId: 'trace:trace-a',
    step: 'transport_received',
    status: 'pass',
    message: 'a'
  })
  plane.recordStep({
    imTraceId: 'trace-b',
    componentId: 'trace:trace-b',
    step: 'transport_received',
    status: 'fail',
    message: 'b failed'
  })
  plane.recordStep({
    imTraceId: 'trace-c',
    componentId: 'trace:trace-c',
    step: 'transport_received',
    status: 'pass',
    message: 'c'
  })

  const traces = plane.listRecentTraces()

  assert.deepEqual(
    traces.map((trace) => trace.imTraceId),
    ['trace-c', 'trace-b', 'trace-a']
  )
  assert.equal(plane.getTrace('trace-old'), null)
  assert.equal(plane.getTrace('trace-b')?.status, 'fail')
})
