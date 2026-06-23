import type {
  Conversation,
  ConversationBinding,
  CoreCommandService,
  CoreQueryService,
  DeliveryRecord,
  InboundEnvelope,
  InteractionCheckpoint
} from '../core-v2/domain.ts'
import type { ImDoctorPlane } from './im-doctor-plane.ts'

export type ImInteractionRouteResult =
  | { handled: false }
  | {
      handled: true
      interaction: InteractionCheckpoint
      delivery: DeliveryRecord
      answerPayload: unknown
    }

export type ImInteractionRouterDeps = {
  core: Pick<
    CoreCommandService & CoreQueryService,
    'listPendingInteractions' | 'answerInteraction' | 'requestDelivery'
  >
  doctorPlane: ImDoctorPlane
}

export type ImInteractionRouterInput = {
  imTraceId: string
  envelope: InboundEnvelope
  conversation: Conversation
  binding: ConversationBinding
}

export class ImInteractionRouter {
  private readonly core: ImInteractionRouterDeps['core']
  private readonly doctorPlane: ImDoctorPlane

  constructor(deps: ImInteractionRouterDeps) {
    this.core = deps.core
    this.doctorPlane = deps.doctorPlane
  }

  tryHandle(input: ImInteractionRouterInput): ImInteractionRouteResult {
    const replyMode = resolveReplyMode(input.envelope)
    const candidate = this.selectCandidate(input, replyMode)
    if (!candidate) return { handled: false }

    const parsed = parseInteractionAnswer(candidate, input.envelope.text)
    if (!parsed.accepted) {
      const delivery = this.core.requestDelivery({
        conversationId: input.conversation.id,
        bindingId: input.binding.id,
        mode: 'send',
        transportDeliveryMode: 'reply',
        doctorTraceId: input.imTraceId,
        replyContext: {
          replyToMessageId: input.envelope.externalMessageId
        },
        payload: {
          kind: 'text',
          text: parsed.message
        }
      })
      this.doctorPlane.recordStep({
        imTraceId: input.imTraceId,
        step: 'interaction_checked',
        status: 'warn',
        message: `Could not parse answer for interaction ${candidate.id}`,
        detail: { interactionId: candidate.id, kind: candidate.kind }
      })
      return {
        handled: true,
        interaction: candidate,
        delivery,
        answerPayload: null
      }
    }

    const interaction = this.core.answerInteraction({ interactionId: candidate.id })
    const delivery = this.core.requestDelivery({
      conversationId: input.conversation.id,
      bindingId: input.binding.id,
      mode: 'send',
      transportDeliveryMode: 'reply',
      doctorTraceId: input.imTraceId,
      replyContext: {
        replyToMessageId: input.envelope.externalMessageId
      },
      payload: {
        kind: 'text',
        text: `Interaction answered: ${candidate.kind}`
      }
    })
    this.doctorPlane.recordStep({
      imTraceId: input.imTraceId,
      step: 'interaction_checked',
      status: 'pass',
      message: `Answered interaction ${candidate.id}`,
      detail: {
        interactionId: candidate.id,
        kind: candidate.kind,
        answerPayload: parsed.payload
      }
    })
    return {
      handled: true,
      interaction,
      delivery,
      answerPayload: parsed.payload
    }
  }

  private selectCandidate(
    input: ImInteractionRouterInput,
    replyMode: 'text' | 'card_callback' | 'file_upload'
  ): InteractionCheckpoint | null {
    const now = Date.now()
    const candidates = this.core
      .listPendingInteractions(input.conversation.id)
      .filter((interaction) => {
        if (interaction.expectedBindingId && interaction.expectedBindingId !== input.binding.id)
          return false
        if (interaction.expectedPersonId && interaction.expectedPersonId !== input.binding.personId)
          return false
        if (interaction.expiresAt && Date.parse(interaction.expiresAt) <= now) return false
        if (
          interaction.acceptedReplyModes?.length &&
          !interaction.acceptedReplyModes.includes(replyMode)
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return candidates[0] ?? null
  }
}

const resolveReplyMode = (envelope: InboundEnvelope): 'text' | 'card_callback' | 'file_upload' => {
  if (envelope.messageType === 'card') return 'card_callback'
  if (envelope.messageType === 'file' || envelope.messageType === 'image') return 'file_upload'
  return 'text'
}

const parseInteractionAnswer = (
  interaction: InteractionCheckpoint,
  text?: string | null
): { accepted: true; payload: unknown } | { accepted: false; message: string } => {
  const trimmed = text?.trim()
  if (!trimmed) return { accepted: false, message: 'Please reply with a non-empty answer.' }

  if (interaction.kind === 'approval') {
    const normalized = trimmed.toLowerCase()
    if (['yes', 'y', 'ok', 'approve', 'approved', '同意', '确认', '可以'].includes(normalized)) {
      return { accepted: true, payload: { approved: true, rawInput: trimmed } }
    }
    if (['no', 'n', 'reject', 'rejected', 'deny', '拒绝', '取消', '不可以'].includes(normalized)) {
      return { accepted: true, payload: { approved: false, rawInput: trimmed } }
    }
    return { accepted: false, message: 'Please reply yes/no or 同意/拒绝.' }
  }

  if (
    interaction.kind === 'text_input' ||
    interaction.kind === 'option_select' ||
    interaction.kind === 'multi_step_form' ||
    interaction.kind === 'file_upload_request'
  ) {
    return { accepted: true, payload: { rawInput: trimmed } }
  }

  return { accepted: false, message: 'Unsupported interaction type.' }
}
