import { BrowserWindow } from 'electron'
import type { AgentAppEvent } from '../../shared/agent-runtime.ts'
import type { ConversationEventRow } from '../../preload/db-types.ts'
import type { PendingQuestionEvent } from '../../shared/question-tool.ts'
import type { PendingQuestionnaireEvent } from '../../shared/questionnaire-tool.ts'
import type { PendingSecretPromptEvent } from '../../shared/secret-input.ts'
import type { ThreadPlanEvent } from '../../shared/thread-plan.ts'
import type { SubagentPanelEvent } from '../../shared/subagent-panel.ts'

export const emitGatewayAgentEvent = (threadId: string, event: AgentAppEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:event', {
      ...event,
      __chatThreadId: threadId
    })
  }
}

export const emitGatewayQuestionEvent = (event: PendingQuestionEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:question', event)
  }
}

export const emitGatewayQuestionnaireEvent = (event: PendingQuestionnaireEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:questionnaire', event)
  }
}

export const emitGatewaySecretEvent = (event: PendingSecretPromptEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:secret', event)
  }
}

export const emitGatewayThreadPlanEvent = (event: ThreadPlanEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:thread-plan', event)
  }
}

export const emitGatewaySubagentPanelEvent = (event: SubagentPanelEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:subagent-panel', event)
  }
}

export const emitGatewayAgentDebugEvent = (threadId: string, event: ConversationEventRow): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('agent:debug-event', {
      ...event,
      __chatThreadId: threadId
    })
  }
}
