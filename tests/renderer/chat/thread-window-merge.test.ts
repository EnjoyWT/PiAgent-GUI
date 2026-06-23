import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareChatMessagesByTimeline,
  mergeLatestWindowAuthoritatively,
  preserveLatestInlineWidgetRuntimeState
} from '../../../src/renderer/src/utils/thread-window-merge.ts'
import type { ChatMessage } from '../../../src/renderer/src/components/chat/types.ts'

test('compareChatMessagesByTimeline sorts by createdAt then runtimeSequence', () => {
  const earlier: ChatMessage = {
    id: '1',
    role: 'user',
    content: 'earlier',
    createdAt: '2026-04-21 02:21:53.434',
    runtimeSequence: 3
  }
  const later: ChatMessage = {
    id: '2',
    role: 'user',
    content: 'later',
    createdAt: '2026-04-21 02:22:53.448',
    runtimeSequence: 18
  }

  assert.ok(compareChatMessagesByTimeline(earlier, later) < 0)
  assert.ok(compareChatMessagesByTimeline(later, earlier) > 0)
})

test('compareChatMessagesByTimeline keeps runtime order when older live messages lack createdAt', () => {
  const earlierLive: ChatMessage = {
    id: 'live-1',
    role: 'user',
    content: 'first',
    runtimeSequence: 3
  }
  const laterPersisted: ChatMessage = {
    id: 'live-2',
    role: 'user',
    content: 'second',
    createdAt: '2026-04-21 02:55:30.263',
    runtimeSequence: 91
  }

  assert.ok(compareChatMessagesByTimeline(earlierLive, laterPersisted) < 0)
  assert.ok(compareChatMessagesByTimeline(laterPersisted, earlierLive) > 0)
})

test('compareChatMessagesByTimeline keeps a persisted user message ahead of a metadata-less assistant placeholder', () => {
  const user: ChatMessage = {
    role: 'user',
    content: '你好呀',
    createdAt: '2026-04-21 03:12:21.555',
    runtimeSequence: 3
  }
  const placeholder: ChatMessage = {
    role: 'assistant',
    content: '思考中...',
    isPending: true
  }

  assert.ok(compareChatMessagesByTimeline(user, placeholder) < 0)
  assert.ok(compareChatMessagesByTimeline(placeholder, user) > 0)
})

test('compareChatMessagesByTimeline stays stable when a live seq-only assistant appears after persisted history', () => {
  const assistant1: ChatMessage = {
    id: 'assistant-1',
    role: 'assistant',
    content: 'first answer',
    createdAt: '2026-04-21T07:02:24.047Z'
  }
  const user2: ChatMessage = {
    id: 'user-2',
    role: 'user',
    content: '你可以做什么',
    createdAt: '2026-04-21T07:02:27.721Z',
    runtimeSequence: 18
  }
  const assistant2: ChatMessage = {
    role: 'assistant',
    content: '',
    runtimeSequence: 20
  }

  const sorted = [assistant2, assistant1, user2].sort(compareChatMessagesByTimeline)

  assert.deepEqual(sorted, [assistant1, user2, assistant2])
})

test('mergeLatestWindowAuthoritatively preserves older history and replaces the latest page', () => {
  const older: ChatMessage = {
    id: 'older',
    role: 'user',
    content: 'older history',
    createdAt: '2026-04-21 02:20:00.000',
    runtimeSequence: 1
  }
  const staleLatest: ChatMessage = {
    id: 'stale',
    role: 'user',
    content: 'stale wrong latest',
    createdAt: '2026-04-21 02:22:54.000',
    runtimeSequence: 19
  }
  const latestPage: ChatMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '你是谁',
      createdAt: '2026-04-21 02:21:53.434',
      runtimeSequence: 3
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '我是 yolo',
      createdAt: '2026-04-21 02:21:57.316',
      runtimeSequence: 5
    },
    {
      id: 'user-2',
      role: 'user',
      content: '你引用的图片都是无法访问的',
      createdAt: '2026-04-21 02:22:53.448',
      runtimeSequence: 18
    },
    {
      id: 'assistant-2',
      role: 'assistant',
      content: '哎呀，尴尬了',
      createdAt: '2026-04-21 02:22:57.665',
      runtimeSequence: 20
    }
  ]

  const merged = mergeLatestWindowAuthoritatively([older, staleLatest], latestPage)

  assert.deepEqual(
    merged.map((message) => message.id),
    ['older', 'user-1', 'assistant-1', 'user-2', 'assistant-2']
  )
})

test('mergeLatestWindowAuthoritatively replaces retry anchor when persisted metadata changes', () => {
  const retryAnchorBeforeRuntime: ChatMessage = {
    id: 'retry-user-1',
    role: 'user',
    content: '111',
    submissionId: 'submission-retry-1',
    createdAt: '2026-05-26T10:10:00.000+08:00'
  }
  const retryAnchorAfterRuntime: ChatMessage = {
    id: 'retry-user-1',
    role: 'user',
    content: '111',
    agentRunId: 'run-retry-1',
    agentTurnId: 'turn-retry-1',
    runtimeSequence: 3,
    createdAt: '2026-05-26T10:14:53.876+08:00'
  }

  const merged = mergeLatestWindowAuthoritatively(
    [retryAnchorBeforeRuntime],
    [retryAnchorAfterRuntime]
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0], retryAnchorAfterRuntime)
})

test('mergeLatestWindowAuthoritatively drops an unpersisted assistant turn when the latest page contains the persisted turn', () => {
  const liveAssistant: ChatMessage = {
    role: 'assistant',
    content: '你好呀！找我有事吗？😊',
    agentRunId: 'run-1',
    agentTurnId: 'turn-1',
    createdAt: '2026-04-21T03:12:24.368Z'
  }
  const latestPage: ChatMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: '你好呀',
      submissionId: 'submission-1',
      createdAt: '2026-04-21T03:12:21.555Z'
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '你好呀！找我有事吗？😊',
      agentRunId: 'run-1',
      agentTurnId: 'turn-1',
      createdAt: '2026-04-21T03:12:24.368Z'
    }
  ]

  const merged = mergeLatestWindowAuthoritatively([liveAssistant], latestPage)

  assert.equal(
    merged.filter((message) => message.role === 'assistant' && message.agentTurnId === 'turn-1')
      .length,
    1
  )
})

test('mergeLatestWindowAuthoritatively drops stale cache when latest page is empty', () => {
  const staleUser: ChatMessage = {
    role: 'user',
    content: '五一上海哪里比较好玩',
    submissionId: 'stale-submission',
    createdAt: '2026-04-30T10:05:09.796+08:00'
  }
  const staleAssistant: ChatMessage = {
    role: 'assistant',
    content: '思考中...',
    isPending: true
  }

  const merged = mergeLatestWindowAuthoritatively([staleUser, staleAssistant], [])

  assert.deepEqual(merged, [])
})

test('preserveLatestInlineWidgetRuntimeState carries hydrated widget runtime fields into the latest page', () => {
  const existing: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      agentRunId: 'run-1',
      agentTurnId: 'turn-1',
      widget: {
        kind: 'html',
        placement: 'inline',
        title: 'Widget',
        html: '<div>widget</div>',
        url: 'http://local/widget-1',
        widgetId: 'widget-1'
      }
    }
  ]

  const latestPage: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      agentRunId: 'run-1',
      agentTurnId: 'turn-1',
      widget: {
        kind: 'html',
        placement: 'inline',
        title: 'Widget',
        html: '<div>widget</div>'
      }
    }
  ]

  const preserved = preserveLatestInlineWidgetRuntimeState(existing, latestPage)

  assert.equal(preserved[0]?.widget?.url, 'http://local/widget-1')
  assert.equal(preserved[0]?.widget?.widgetId, 'widget-1')
})

test('preserveLatestInlineWidgetRuntimeState does not reuse runtime fields when widget html changed', () => {
  const existing: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      agentRunId: 'run-1',
      agentTurnId: 'turn-1',
      widget: {
        kind: 'html',
        placement: 'inline',
        title: 'Widget',
        html: '<div>old</div>',
        url: 'http://local/widget-1',
        widgetId: 'widget-1'
      }
    }
  ]

  const latestPage: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      agentRunId: 'run-1',
      agentTurnId: 'turn-1',
      widget: {
        kind: 'html',
        placement: 'inline',
        title: 'Widget',
        html: '<div>new</div>'
      }
    }
  ]

  const preserved = preserveLatestInlineWidgetRuntimeState(existing, latestPage)

  assert.equal(preserved[0]?.widget?.url, undefined)
  assert.equal(preserved[0]?.widget?.widgetId, undefined)
})
