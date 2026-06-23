export type ImDoctorStatus = 'pass' | 'warn' | 'fail'

export type ImPluginDoctor = {
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  accountId: string
  checks: Array<{
    id: string
    status: ImDoctorStatus
    message: string
    observedAt: string
    detail?: unknown
  }>
}

export type ImDoctorStepName =
  | 'transport_received'
  | 'normalized'
  | 'dedupe_checked'
  | 'session_routed'
  | 'identity_resolved'
  | 'conversation_resolved'
  | 'command_checked'
  | 'interaction_checked'
  | 'run_decided'
  | 'delivery_requested'
  | 'delivery_dispatched'
  | 'delivery_result'

export type ImDoctorStep = {
  id: string
  imTraceId: string
  componentId: string
  step: ImDoctorStepName
  status: ImDoctorStatus
  message: string
  detail?: unknown
  createdAt: string
}
