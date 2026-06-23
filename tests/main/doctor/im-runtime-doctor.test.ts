import test from 'node:test'
import assert from 'node:assert/strict'
import { ImDoctorPlane } from '../../../src/main/im/im-doctor-plane.ts'
import { ImRuntimeDoctor } from '../../../src/main/doctor/im-runtime-doctor.ts'

test('IM runtime doctor exposes recent traces as doctor components', async () => {
  const plane = new ImDoctorPlane()
  plane.recordStep({
    imTraceId: 'trace-a',
    componentId: 'trace:trace-a',
    step: 'transport_received',
    status: 'pass',
    message: 'received'
  })
  plane.recordStep({
    imTraceId: 'trace-b',
    componentId: 'trace:trace-b',
    step: 'conversation_resolved',
    status: 'fail',
    message: 'conversation failed',
    detail: { error: 'missing binding' }
  })

  const doctor = new ImRuntimeDoctor(plane)
  const components = await doctor.listComponents()
  const failed = await doctor.getComponentStatus('trace:trace-b')
  const summary = await doctor.getSummary()

  assert.equal(doctor.info.domainId, 'im-runtime')
  assert.equal(components.length, 2)
  assert.equal(components[0]?.componentId, 'trace:trace-b')
  assert.equal(failed.status, 'unavailable')
  assert.equal(failed.stage, 'conversation_resolved')
  assert.match(failed.summary, /conversation failed/)
  assert.deepEqual((failed.metadata as any).steps[0].detail, { error: 'missing binding' })
  assert.equal(summary.domain, 'im-runtime')
  assert.equal(summary.status, 'degraded')
  assert.equal(summary.componentCount, 2)
  assert.equal(summary.unavailableCount, 1)
  assert.equal(summary.healthyCount, 1)
})

test('IM runtime doctor reports unknown when no traces exist', async () => {
  const doctor = new ImRuntimeDoctor(new ImDoctorPlane())
  const summary = await doctor.getSummary()

  assert.deepEqual(await doctor.listComponents(), [])
  assert.equal(summary.status, 'unknown')
  assert.equal(summary.componentCount, 0)
})
