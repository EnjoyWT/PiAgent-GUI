export interface WorkspaceRow {
  path: string
  name: string | null
  last_opened_at: string | null
  created_at: string
}

export interface WorkspaceSettingsRow {
  workspace_path: string
  model: string | null
  mcp_enabled: string | null
}

export interface WorkspaceMcpServerRow {
  workspace_path: string
  server_id: string
  enabled: number
  updated_at: string
}

export interface WorkspaceSandboxGrantRow {
  workspace_path: string
  granted_path: string
  access_mode: 'read' | 'write'
  created_at: string | null
  updated_at: string | null
}

export interface ThreadRow {
  id: string
  workspace_path: string
  title: string | null
  model: string | null
  created_at: string
  started_at: string | null
}

export interface MessageRow {
  id: string
  thread_id: string
  role: 'user' | 'assistant' | 'tool'
  message_kind:
    'chat' | 'automation' | 'question_answer' | 'questionnaire_question' | 'questionnaire_answer'
  include_in_agent_context: number
  content: string
  content_json: string | null
  agent_run_id: string | null
  agent_entry_id: string | null
  agent_turn_id: string | null
  tool_call_id: string | null
  step_index: number | null
  runtime_sequence: number | null
  created_at: string
}

export interface AgentRunRow {
  id: string
  thread_id: string
  status: 'running' | 'done' | 'error' | 'aborted'
  text: string
  turns_json: string
  started_at: number
  ended_at: number | null
}

export interface ConversationEventRow {
  id: string
  thread_id: string
  agent_run_id: string | null
  runtime_agent_run_id?: string | null
  event_type: string
  event_origin: string
  correlation_id: string
  payload_json: string
  raw_json: string | null
  created_at: number
}
