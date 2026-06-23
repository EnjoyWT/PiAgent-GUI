export const SYSTEM_FOLLOWUP_RUNTIME_PROMPT =
  'Respond to the system event above in the current conversation.'

export const isSystemFollowupSyntheticPromptText = (text: string | null | undefined): boolean =>
  String(text ?? '').trim() === SYSTEM_FOLLOWUP_RUNTIME_PROMPT
