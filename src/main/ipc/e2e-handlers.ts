import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AgentAppEvent, AgentRunProjection } from '@shared/agent-runtime'

type SimulateAgentStreamInput = {
  chatThreadId: string
  text: string
  chunkSize?: number
  delayMs?: number
}

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const chunkText = (text: string, chunkSize: number): string[] => {
  const normalized = String(text ?? '')
  if (!normalized) return ['']
  const size = Math.max(1, Math.trunc(chunkSize || 0))
  const chunks: string[] = []
  for (let index = 0; index < normalized.length; index += size) {
    chunks.push(normalized.slice(index, index + size))
  }
  return chunks
}

const buildRunProjection = (input: {
  threadId: string
  runId: string
  startedAt: number
  status: AgentRunProjection['status']
  text: string
  endedAt?: number
}): AgentRunProjection => ({
  threadId: input.threadId,
  agentRunId: input.runId,
  status: input.status,
  startedAt: input.startedAt,
  endedAt: input.endedAt,
  turns: [],
  messages: [],
  toolCalls: [],
  text: input.text
})

export function setupE2EHandlers(): void {
  ipcMain.removeHandler('e2e:agent:simulate-stream')

  ipcMain.handle(
    'e2e:agent:simulate-stream',
    async (
      event,
      input: SimulateAgentStreamInput
    ): Promise<{ success: true; runId: string; agentMessageId: string }> => {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
      if (!targetWindow || targetWindow.isDestroyed()) {
        throw new Error('Target window is not available for E2E stream simulation')
      }

      const threadId = String(input.chatThreadId ?? '').trim()
      if (!threadId) throw new Error('chatThreadId is required')

      const text = String(input.text ?? '')
      const delayMs = Math.max(0, Math.trunc(input.delayMs ?? 10))
      const chunkSize = Math.max(1, Math.trunc(input.chunkSize ?? 8))
      const chunks = chunkText(text, chunkSize)
      const runId = `e2e-run-${randomUUID()}`
      const agentTurnId = `e2e-turn-${randomUUID()}`
      const agentMessageId = `e2e-message-${randomUUID()}`
      const traceId = `e2e-trace-${randomUUID()}`
      let sequence = 0
      const startedAt = Date.now()

      const emitEvent = (payload: AgentAppEvent): void => {
        if (targetWindow.isDestroyed()) return
        targetWindow.webContents.send('agent:event', {
          ...payload,
          __chatThreadId: threadId
        })
      }

      const createBaseEvent = <T extends AgentAppEvent['type']>(type: T, timestamp: number) => ({
        id: `${type}:${randomUUID()}`,
        type,
        timestamp,
        threadId,
        agentRunId: runId,
        agentTurnId: null,
        traceId,
        correlationId: traceId,
        causationId: null,
        parentEventId: null,
        sequence: sequence++
      })

      emitEvent({
        ...createBaseEvent('agent.run.started', startedAt),
        agentRunId: runId,
        run: buildRunProjection({
          threadId,
          runId,
          startedAt,
          status: 'running',
          text: ''
        })
      })

      for (const chunk of chunks) {
        await delay(delayMs)
        emitEvent({
          ...createBaseEvent('agent.message.delta', Date.now()),
          agentRunId: runId,
          agentMessageId,
          agentTurnId,
          contentKind: 'text',
          delta: chunk
        })
      }

      const finishedAt = Date.now()
      emitEvent({
        ...createBaseEvent('agent.run.finished', finishedAt),
        agentRunId: runId,
        run: buildRunProjection({
          threadId,
          runId,
          startedAt,
          endedAt: finishedAt,
          status: 'done',
          text
        })
      })

      return {
        success: true,
        runId,
        agentMessageId
      }
    }
  )
}
