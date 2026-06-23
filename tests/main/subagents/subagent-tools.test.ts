import test from 'node:test'
import assert from 'node:assert/strict'
import { createSubagentTools } from '../../../src/main/subagents/subagent-tools.ts'
import type {
  DelegateWorkersInput,
  DelegateWorkersResult,
  WaitForGroupInput,
  WaitForGroupResult
} from '../../../src/main/subagents/subagent-types.ts'
import type { SupervisorGroupReport } from '../../../src/main/subagents/supervisor-reporter.ts'
import { testWorkerRuntimeModel } from './runtime-model-fixture.ts'

class FakeTaskManagerClient {
  delegateInputs: DelegateWorkersInput[] = []
  waitInputs: WaitForGroupInput[] = []
  reportInputs: Array<{ groupId: string; afterEventSeq?: number }> = []
  collectInputs: Array<{ groupId: string }> = []
  retryInputs: Array<{ taskId: string }> = []
  cancelInputs: Array<{ taskId: string; reason: string }> = []
  cancelGroupInputs: Array<{ groupId: string; reason: string }> = []

  async delegateWorkers(input: DelegateWorkersInput): Promise<DelegateWorkersResult> {
    this.delegateInputs.push(input)
    return {
      groupId: 'group-1',
      tasks: [{ taskId: 'task-1', label: 'Scout', status: 'running' }]
    }
  }

  async waitForGroup(input: WaitForGroupInput): Promise<WaitForGroupResult> {
    this.waitInputs.push(input)
    return {
      waitStatus: 'settled',
      groupStatus: 'completed',
      completedResults: []
    }
  }

  buildSupervisorReport(input: { groupId: string; afterEventSeq?: number }): SupervisorGroupReport {
    this.reportInputs.push(input)
    return {
      groupId: input.groupId,
      groupStatus: 'running',
      nextCursor: 3,
      tasks: [],
      events: [],
      markdown: '# Report'
    }
  }

  collectWorkerResults(input: { groupId: string }) {
    this.collectInputs.push(input)
    return {
      groupId: input.groupId,
      groupStatus: 'completed' as const,
      completedResults: []
    }
  }

  async retryWorker(input: { taskId: string }) {
    this.retryInputs.push(input)
    return {
      taskId: input.taskId,
      attemptId: 'attempt-2',
      attemptNumber: 2,
      status: 'running' as const
    }
  }

  async cancelWorker(input: { taskId: string; reason: string }) {
    this.cancelInputs.push(input)
    return {
      taskId: input.taskId,
      attemptId: 'attempt-1',
      status: 'cancel_requested' as const
    }
  }

  async cancelWorkerGroup(input: { groupId: string; reason: string }) {
    this.cancelGroupInputs.push(input)
    return {
      groupId: input.groupId,
      groupStatus: 'running' as const,
      tasks: []
    }
  }
}

test('delegate_workers tool uses runtime parent identity instead of model supplied ids', async () => {
  const client = new FakeTaskManagerClient()
  const [delegateTool] = createSubagentTools({
    taskManager: client,
    context: {
      parentConversationId: 'conversation-real',
      parentRunId: 'run-real',
      parentMessageId: 'message-real',
      cwd: '/repo',
      parentRuntimeModel: testWorkerRuntimeModel
    }
  })

  const result = await delegateTool!.execute(
    'tool-call-real',
    {
      parentConversationId: 'conversation-forged',
      parentRunId: 'run-forged',
      parentToolCallId: 'tool-call-forged',
      cwd: '/tmp/forged',
      tasks: [
        {
          label: 'Scout',
          instruction: 'Inspect scheduler',
          workspaceMode: 'readonly',
          toolAllowlist: ['read', 'bash', 'delegate_workers']
        }
      ]
    },
    new AbortController().signal,
    () => {},
    {} as any
  )

  assert.equal(client.delegateInputs[0]?.parentConversationId, 'conversation-real')
  assert.equal(client.delegateInputs[0]?.parentRunId, 'run-real')
  assert.equal(client.delegateInputs[0]?.parentMessageId, 'message-real')
  assert.equal(client.delegateInputs[0]?.parentToolCallId, 'tool-call-real')
  assert.equal(client.delegateInputs[0]?.cwd, '/repo')
  assert.equal(client.delegateInputs[0]?.runtimeModel.providerConfig.apiKey, 'runtime-secret-key')
  assert.deepEqual(client.delegateInputs[0]?.tasks[0]?.toolAllowlist, ['read'])
  assert.equal((result.details as any).groupId, 'group-1')
})

test('wait_worker_group tool delegates waiting to TaskManagerClient only', async () => {
  const client = new FakeTaskManagerClient()
  const tools = createSubagentTools({
    taskManager: client,
    context: {
      parentConversationId: 'conversation-real',
      parentRunId: 'run-real',
      parentMessageId: null,
      cwd: '/repo'
    }
  })
  const waitTool = tools.find((tool) => tool.name === 'wait_worker_group')
  assert.ok(waitTool)

  const result = await waitTool.execute(
    'tool-call-wait',
    { groupId: 'group-1', timeoutMs: 10 },
    new AbortController().signal,
    () => {},
    {} as any
  )

  assert.deepEqual(client.waitInputs, [{ groupId: 'group-1', timeoutMs: 10 }])
  assert.equal((result.details as any).waitStatus, 'settled')
})

test('inspect_supervisor_report tool delegates report generation to TaskManagerClient', async () => {
  const client = new FakeTaskManagerClient()
  const tools = createSubagentTools({
    taskManager: client,
    context: {
      parentConversationId: 'conversation-real',
      parentRunId: 'run-real',
      parentMessageId: null,
      cwd: '/repo'
    }
  })
  const reportTool = tools.find((tool) => tool.name === 'inspect_supervisor_report')
  assert.ok(reportTool)

  const result = await reportTool.execute(
    'tool-call-report',
    { groupId: 'group-1', afterEventSeq: 2 },
    new AbortController().signal,
    () => {},
    {} as any
  )

  assert.deepEqual(client.reportInputs, [{ groupId: 'group-1', afterEventSeq: 2 }])
  assert.equal((result.details as any).nextCursor, 3)
  assert.equal((result.content[0] as any)?.text, '# Report')
})

test('worker management tools delegate collect retry and cancel to TaskManagerClient', async () => {
  const client = new FakeTaskManagerClient()
  const tools = createSubagentTools({
    taskManager: client,
    context: {
      parentConversationId: 'conversation-real',
      parentRunId: 'run-real',
      parentMessageId: null,
      cwd: '/repo'
    }
  })

  await tools.find((tool) => tool.name === 'collect_worker_results')!.execute(
    'tool-call-collect',
    { groupId: 'group-1' },
    new AbortController().signal,
    () => {},
    {} as any
  )
  await tools.find((tool) => tool.name === 'retry_worker')!.execute(
    'tool-call-retry',
    { taskId: 'task-1' },
    new AbortController().signal,
    () => {},
    {} as any
  )
  await tools.find((tool) => tool.name === 'cancel_worker')!.execute(
    'tool-call-cancel',
    { taskId: 'task-1', reason: 'bad route' },
    new AbortController().signal,
    () => {},
    {} as any
  )
  await tools.find((tool) => tool.name === 'cancel_worker_group')!.execute(
    'tool-call-cancel-group',
    { groupId: 'group-1', reason: 'stop all' },
    new AbortController().signal,
    () => {},
    {} as any
  )

  assert.deepEqual(client.collectInputs, [{ groupId: 'group-1' }])
  assert.deepEqual(client.retryInputs, [{ taskId: 'task-1' }])
  assert.deepEqual(client.cancelInputs, [{ taskId: 'task-1', reason: 'bad route' }])
  assert.deepEqual(client.cancelGroupInputs, [{ groupId: 'group-1', reason: 'stop all' }])
})
