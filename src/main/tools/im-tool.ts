import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import type { RuntimeSurfaceToolContext } from '../runtime-host/runtime-surface/runtime-surface-types.ts'
import type {
  RuntimeFormField,
  RuntimeUserInteractionController
} from '../runtime-host/user-interaction-controller.ts'
import type { ConversationChannelKind } from '../core-v2/domain.ts'
import type { EmbeddedGatewayService } from '../transport/embedded-gateway.ts'
import type {
  TransportPluginAccountSetupMethod,
  TransportPluginAccountSetupStartResult,
  TransportPluginSettingsField,
  TransportPluginSettingsSchema
} from '../../shared/transport-plugins.ts'

type CreateImToolOptions = {
  gatewayService: EmbeddedGatewayService
  interactionController: RuntimeUserInteractionController
  context: RuntimeSurfaceToolContext
}

const channelKindSchema = Type.Optional(
  Type.String({
    enum: ['dm', 'group', 'thread', 'webhook', 'api']
  })
)

const parametersSchema = Type.Object(
  {
    action: Type.String({
      enum: [
        'list_transports',
        'list_targets',
        'list_routes',
        'send_message',
        'attach_route',
        'set_active_route',
        'setup_account',
        'connect_account',
        'disconnect_account'
      ],
      description:
        'Operation to run. Use list_transports first when unsure. Use list_targets to discover plugin-provided chats or contacts before send_message.'
    }),
    transportId: Type.Optional(
      Type.String({
        description:
          'IM transport id, for example feishu. For list_targets and send_message, provide this unless using an existing bindingId/conversation active route.'
      })
    ),
    accountId: Type.Optional(
      Type.String({
        description:
          'Transport account id, usually default. If omitted for single-account transports, imTool will infer the only configured/default account.'
      })
    ),
    conversationId: Type.Optional(
      Type.String({
        description:
          'PiAgent internal conversation id. Use only when continuing an existing PiAgent conversation; this is not a Feishu chat/conversation id.'
      })
    ),
    bindingId: Type.Optional(
      Type.String({
        description:
          'PiAgent internal route binding id from list_routes/list_targets. Use only as bindingId; never pass it as externalChatId, externalThreadId, externalUserId, or a Feishu conversation id.'
      })
    ),
    externalChatId: Type.Optional(
      Type.String({
        description:
          'External chat/conversation id. For Feishu group messages this is the oc_xxx chat_id.'
      })
    ),
    externalThreadId: Type.Optional(
      Type.String({
        description:
          'External platform thread/reply target id. For Feishu thread replies this is the platform message/root id, not a PiAgent route binding id.'
      })
    ),
    externalUserId: Type.Optional(
      Type.String({
        description:
          'External user receiver id. For Feishu direct messages this can be an open_id/user_id/union_id/email.'
      })
    ),
    channelKind: channelKindSchema,
    title: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    query: Type.Optional(
      Type.String({
        description:
          'Search string for list_targets. For Feishu dm use a real name, email, mobile, or user id; for group use a group chat name keyword.'
      })
    ),
    limit: Type.Optional(Type.Number()),
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    setupMethodId: Type.Optional(Type.String()),
    setAsActiveRoute: Type.Optional(Type.Boolean()),
    validateAfterSave: Type.Optional(Type.Boolean()),
    disableOnStartup: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const asTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const asChannelKind = (value: unknown): ConversationChannelKind | null => {
  const normalized = asTrimmed(value)
  if (
    normalized === 'dm' ||
    normalized === 'group' ||
    normalized === 'thread' ||
    normalized === 'webhook' ||
    normalized === 'api'
  ) {
    return normalized
  }
  return null
}

type ImKnownTarget = Awaited<ReturnType<EmbeddedGatewayService['listImTargets']>>[number]

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const findMissingRequiredNonSecretFields = (
  schema: TransportPluginSettingsSchema,
  config: Record<string, unknown>,
  existingConfig: Record<string, unknown>
): TransportPluginSettingsField[] =>
  schema.fields.filter((field) => {
    if (field.type === 'secret' || !field.required) return false
    const rawValue = hasOwn(config, field.key)
      ? config[field.key]
      : (existingConfig[field.key] ?? field.defaultValue)
    if (rawValue === null || rawValue === undefined) return true
    if (typeof rawValue === 'string') return !rawValue.trim()
    return false
  })

const toFormField = (
  field: TransportPluginSettingsField,
  existingConfig: Record<string, unknown>
): RuntimeFormField => ({
  key: field.key,
  label: field.label,
  type:
    field.type === 'select' || field.type === 'boolean' || field.type === 'number'
      ? field.type
      : 'text',
  required: Boolean(field.required),
  description: field.description,
  placeholder: field.placeholder,
  options:
    field.type === 'select'
      ? (field.options ?? []).map((option) => ({
          id: option.value,
          label: option.label,
          value: option.value
        }))
      : undefined,
  defaultValue: field.defaultValue ?? null,
  currentValue: (existingConfig[field.key] as string | number | boolean | null | undefined) ?? null
})

const defaultManualSetupMethod = (
  schema: TransportPluginSettingsSchema
): TransportPluginAccountSetupMethod => ({
  id: 'manual_config',
  kind: 'form',
  label: '手动填写配置',
  fields: schema.fields.map((field) => field.key)
})

const listSetupMethods = async (
  gatewayService: EmbeddedGatewayService,
  transportId: string,
  schema: TransportPluginSettingsSchema
): Promise<TransportPluginAccountSetupMethod[]> => {
  try {
    const methods = await gatewayService.listTransportAccountSetupMethods(transportId)
    return methods.length > 0 ? methods : [defaultManualSetupMethod(schema)]
  } catch {
    return schema.setupMethods?.length ? schema.setupMethods : [defaultManualSetupMethod(schema)]
  }
}

const selectSetupMethod = async (
  input: Record<string, unknown>,
  interactionController: RuntimeUserInteractionController,
  context: RuntimeSurfaceToolContext,
  signal: AbortSignal | undefined,
  transportId: string,
  accountId: string,
  displayName: string,
  methods: TransportPluginAccountSetupMethod[]
): Promise<
  | { status: 'selected'; method: TransportPluginAccountSetupMethod }
  | { status: 'aborted'; details: unknown }
> => {
  const requestedMethodId = asTrimmed(input.setupMethodId)
  if (requestedMethodId) {
    const method = methods.find((item) => item.id === requestedMethodId)
    if (!method) {
      throw new Error(`Unknown setupMethodId for ${transportId}: ${requestedMethodId}`)
    }
    return { status: 'selected', method }
  }

  if (methods.length <= 1) {
    return {
      status: 'selected',
      method: methods[0] ?? { id: 'manual_config', kind: 'form', label: '手动填写配置' }
    }
  }

  const questionnaire = await interactionController.requestQuestionnaireInput(
    context,
    {
      questionnaireId: `transport-setup-method:${transportId}:${accountId}`,
      title: `${displayName} 接入方式`,
      questions: [
        {
          questionId: 'setupMethod',
          title: '选择接入方式',
          prompt: `请选择 ${displayName} 账号 ${accountId} 的接入方式。`,
          mode: 'selection_or_text',
          options: methods.map((method) => ({
            id: method.id,
            label: method.recommended ? `${method.label}（推荐）` : method.label,
            value: method.id,
            description: method.description
          }))
        }
      ]
    },
    signal,
    `transport-setup-method:${transportId}:${accountId}`
  )

  if (questionnaire.status !== 'completed') {
    return { status: 'aborted', details: questionnaire }
  }

  const answer = questionnaire.answers[0]
  const selectedMethodId =
    answer?.inputKind === 'option' ? answer.optionId : asTrimmed(answer?.rawInput)
  const method = methods.find((item) => item.id === selectedMethodId)
  if (!method) {
    throw new Error(`Unknown setup method selected for ${transportId}: ${selectedMethodId}`)
  }
  return { status: 'selected', method }
}

const summarizeSetupSession = (
  displayName: string,
  session: TransportPluginAccountSetupStartResult
): string => {
  const qrEvent = session.events?.find((event) => event.type === 'qr')
  const parts = [`${displayName} account setup session ${session.sessionId} started.`]
  if (qrEvent) {
    parts.push(
      'Do not repeat the QR image, link, QR text, or expiry in assistant text.',
      'Tell the user only to scan the QR with WeChat. Do not mention where or how the QR is displayed. Do not ask the user to confirm manually; the transport plugin monitors scan and confirmation status through setup events. If the QR code expires, call imTool setup_account again to generate a new one.'
    )
  }
  return parts.filter(Boolean).join('\n')
}

const resolveAccountId = async (
  gatewayService: EmbeddedGatewayService,
  transportId: string,
  requestedAccountId: string
): Promise<string> => {
  if (requestedAccountId) return requestedAccountId
  const manifest = await gatewayService.getTransportPluginManifest(transportId)
  const schema = manifest?.contributes?.settings
  const accounts = await gatewayService.listTransportAccounts(transportId).catch(() => [])
  if (accounts.length === 1) return accounts[0]!.accountId
  if (schema?.supportsMultipleAccounts === false) return accounts[0]?.accountId || 'default'
  throw new Error('accountId is required')
}

const isDirectUserTarget = (target: ImKnownTarget): boolean =>
  target.channelKind === 'dm' &&
  Boolean(target.externalUserId) &&
  target.externalChatId === target.externalUserId

const looksLikeFeishuDirectUserReceiver = (transportId: string, value: string): boolean =>
  transportId === 'feishu' && /^o[un]_/.test(value)

const buildRecommendedSendArgs = (target: ImKnownTarget): Record<string, string> => {
  const args: Record<string, string> = {
    transportId: target.transportId,
    accountId: target.transportAccountId,
    channelKind: target.channelKind
  }

  if (isDirectUserTarget(target)) {
    args.externalUserId = target.externalUserId!
    return args
  }

  args.externalChatId = target.externalChatId
  if (target.externalThreadId) args.externalThreadId = target.externalThreadId
  if (target.externalUserId) args.externalUserId = target.externalUserId
  return args
}

const targetFieldsSummary = (target: ImKnownTarget): string =>
  Object.entries(buildRecommendedSendArgs(target))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')

const toModelVisibleTarget = (target: ImKnownTarget): Record<string, unknown> => {
  const recommendedSendArgs = buildRecommendedSendArgs(target)
  if (!isDirectUserTarget(target)) {
    return {
      ...target,
      recommendedSendArgs
    }
  }

  const { externalChatId: _externalChatId, ...rest } = target
  return {
    ...rest,
    recommendedSendArgs
  }
}

const summarizeTargets = (
  targets: Awaited<ReturnType<EmbeddedGatewayService['listImTargets']>>
) => {
  if (targets.length === 0) return 'No IM targets or routes are currently known.'

  const hasInternalRoutes = targets.some((target) => target.bindingId || target.conversationId)
  const header = [
    'Use target fields as send_message arguments. For DM/contact targets use externalUserId; for group/chat targets use externalChatId.',
    hasInternalRoutes
      ? 'bindingId and conversationId are PiAgent internal ids; use them only in the matching imTool fields.'
      : null
  ]
    .filter(Boolean)
    .join('\n')

  const rows = targets.map((target, index) => {
    const internalFields = [
      target.bindingId
        ? `bindingId=${target.bindingId} (PiAgent internal route id; use only as bindingId)`
        : null,
      target.conversationId
        ? `conversationId=${target.conversationId} (PiAgent internal conversation id; not a platform id)`
        : null,
      target.activeOnConversation ? 'activeRoute=true' : null
    ].filter(Boolean)

    return [
      `${index + 1}. ${target.title}`,
      `   target: ${targetFieldsSummary(target)}`,
      internalFields.length > 0 ? `   internal: ${internalFields.join(', ')}` : null
    ]
      .filter(Boolean)
      .join('\n')
  })

  return [header, ...rows].filter(Boolean).join('\n')
}

export const createImTool = ({
  gatewayService,
  interactionController,
  context
}: CreateImToolOptions): ToolDefinition => ({
  name: 'imTool',
  label: 'IM Tool',
  description:
    'Single canonical tool for IM transport operations. Use it to list IM transports, inspect known chats/routes, send messages, attach routes to conversations, and connect or configure transport accounts. For account connection, use action `setup_account`: it reads plugin-declared setup methods and passes the selected methodId back to the plugin instead of inventing choices. Use `systemDoctorTool` only for self-checks and failure diagnosis; use `imTool` for actual IM work.',
  parameters: parametersSchema,
  execute: async (_toolCallId, params, signal) => {
    const input = isRecord(params) ? params : {}
    const action = asTrimmed(input.action)

    if (action === 'list_transports') {
      const transports = await gatewayService.listImTransports()
      const summary =
        transports.length === 0
          ? 'No IM transports are currently registered.'
          : transports
              .map((transport) => {
                const accountSummary =
                  transport.accounts.length === 0
                    ? 'no accounts'
                    : transport.accounts
                        .map(
                          (account) =>
                            `${account.accountId}:${account.runtimeState ?? (account.enabled ? 'configured' : 'disabled')}`
                        )
                        .join(', ')
                return `${transport.displayName} (${transport.transportId}) - ${transport.state} - ${accountSummary}`
              })
              .join('\n')
      return {
        content: [{ type: 'text' as const, text: summary }],
        details: { transports }
      }
    }

    if (action === 'list_targets' || action === 'list_routes') {
      const transportId = asTrimmed(input.transportId)
      const requestedAccountId = asTrimmed(input.accountId)
      const accountId =
        action === 'list_targets' && transportId
          ? await resolveAccountId(gatewayService, transportId, requestedAccountId)
          : requestedAccountId
      const targets = await gatewayService.listImTargets({
        transportId: transportId || null,
        accountId: accountId || null,
        query: asTrimmed(input.query) || null,
        limit: typeof input.limit === 'number' ? input.limit : null,
        channelKind: asChannelKind(input.channelKind)
      })
      const filtered =
        action === 'list_routes' ? targets.filter((target) => target.bindingId) : targets
      return {
        content: [{ type: 'text' as const, text: summarizeTargets(filtered) }],
        details: { targets: filtered.map(toModelVisibleTarget) }
      }
    }

    if (action === 'send_message') {
      const bindingId = asTrimmed(input.bindingId)
      const transportId = asTrimmed(input.transportId)
      const requestedAccountId = asTrimmed(input.accountId)
      const rawExternalUserId = asTrimmed(input.externalUserId)
      const rawExternalChatId = asTrimmed(input.externalChatId)
      const externalUserId =
        rawExternalUserId ||
        (looksLikeFeishuDirectUserReceiver(transportId, rawExternalChatId) ? rawExternalChatId : '')
      const externalChatId =
        externalUserId && rawExternalChatId === externalUserId ? '' : rawExternalChatId
      const accountId =
        !bindingId && transportId && !requestedAccountId && (externalChatId || externalUserId)
          ? await resolveAccountId(gatewayService, transportId, requestedAccountId)
          : requestedAccountId

      const result = await gatewayService.sendImMessage({
        text: String(input.text ?? ''),
        conversationId: asTrimmed(input.conversationId) || null,
        bindingId: bindingId || null,
        transportId: transportId || null,
        accountId: accountId || null,
        externalChatId: externalChatId || null,
        externalThreadId: asTrimmed(input.externalThreadId) || null,
        externalUserId: externalUserId || null,
        channelKind: asChannelKind(input.channelKind),
        title: asTrimmed(input.title) || null,
        setAsActiveRoute: Boolean(input.setAsActiveRoute)
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: `Message sent via ${result.binding.transportId}/${result.binding.transportAccountId} to ${result.binding.externalChatId}${result.binding.externalThreadId ? `:${result.binding.externalThreadId}` : ''}.`
          }
        ],
        details: result
      }
    }

    if (action === 'attach_route') {
      const result = await gatewayService.attachImRoute({
        conversationId: asTrimmed(input.conversationId),
        transportId: asTrimmed(input.transportId),
        accountId: asTrimmed(input.accountId),
        externalChatId: asTrimmed(input.externalChatId),
        externalThreadId: asTrimmed(input.externalThreadId) || null,
        externalUserId: asTrimmed(input.externalUserId) || null,
        channelKind: asChannelKind(input.channelKind),
        title: asTrimmed(input.title) || null,
        setAsActiveRoute: Boolean(input.setAsActiveRoute)
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Attached route ${result.binding.transportId}/${result.binding.transportAccountId} -> ${result.binding.externalChatId} to conversation ${result.conversation.id}.`
          }
        ],
        details: result
      }
    }

    if (action === 'set_active_route') {
      const conversation = gatewayService.setActiveConversationRoute(
        asTrimmed(input.conversationId),
        asTrimmed(input.bindingId)
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: `Active IM route updated for conversation ${conversation.id}.`
          }
        ],
        details: { conversation }
      }
    }

    if (action === 'setup_account') {
      const transportId = asTrimmed(input.transportId)
      if (!transportId) throw new Error('transportId is required')

      const manifest = await gatewayService.getTransportPluginManifest(transportId)
      const settingsSchema = manifest?.contributes?.settings
      if (!manifest || !settingsSchema) {
        throw new Error(`Transport ${transportId} does not expose configurable account settings`)
      }

      const accountId = await resolveAccountId(
        gatewayService,
        transportId,
        asTrimmed(input.accountId)
      )
      const existing = await gatewayService.getTransportAccount(transportId, accountId)
      const configInput = isRecord(input.config) ? input.config : {}
      const setupMethods = await listSetupMethods(gatewayService, transportId, settingsSchema)
      const selectedSetup = await selectSetupMethod(
        input,
        interactionController,
        context,
        signal,
        transportId,
        accountId,
        manifest.displayName,
        setupMethods
      )
      if (selectedSetup.status !== 'selected') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Transport account setup was cancelled before a setup method was selected.'
            }
          ],
          details: selectedSetup.details
        }
      }

      if (selectedSetup.method.kind !== 'form') {
        const session = await gatewayService.startTransportAccountSetup({
          pluginId: transportId,
          accountId,
          methodId: selectedSetup.method.id,
          initialValues: configInput,
          validateAfterSave: input.validateAfterSave !== false
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: summarizeSetupSession(manifest.displayName, session)
            }
          ],
          details: {
            manifest,
            setupMethod: selectedSetup.method,
            session
          }
        }
      }

      const missingRequiredFields = findMissingRequiredNonSecretFields(
        settingsSchema,
        configInput,
        existing?.config ?? {}
      )
      if (missingRequiredFields.length > 0) {
        const form = await interactionController.requestFormInput(
          context,
          {
            formId: `transport-config:${transportId}:${accountId}`,
            title: `${manifest.displayName} 账号配置`,
            description: `请补全 ${manifest.displayName} 账号 ${accountId} 的必填配置项。`,
            fields: missingRequiredFields.map((field) => toFormField(field, existing?.config ?? {}))
          },
          signal
        )
        if (form.status !== 'completed') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Transport account setup was cancelled before configuration completed.'
              }
            ],
            details: form
          }
        }
        Object.assign(configInput, form.values)
      }

      const secretUpdates: Record<string, string> = {}
      for (const field of settingsSchema.fields) {
        if (field.type !== 'secret' || !field.required) continue
        if (existing?.hasSecrets[field.key]) continue
        const secret = await interactionController.requestSecretInput(
          context,
          {
            secretId: `transport-secret:${transportId}:${accountId}:${field.key}`,
            title: `${manifest.displayName} · ${field.label}`,
            prompt: `请输入 ${manifest.displayName} 账号 ${accountId} 的 ${field.label}。这个值不会回传给模型，也不会写入聊天记录。`,
            placeholder: '安全输入，不会回显到对话',
            confirmLabel: '保存'
          },
          signal
        )
        if (secret.status !== 'answered') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Transport account setup was cancelled before secret input completed.'
              }
            ],
            details: secret
          }
        }
        secretUpdates[field.key] = secret.value
      }

      const saved = await gatewayService.saveTransportAccount({
        pluginId: transportId,
        accountId,
        enabled: true,
        config: configInput,
        secrets: secretUpdates
      })
      await gatewayService.setTransportPluginEnabled({
        pluginId: transportId,
        enabled: true
      })
      if (input.validateAfterSave !== false) {
        await gatewayService.testTransportAccount({
          pluginId: transportId,
          accountId
        })
      }
      const refreshed = await gatewayService.getTransportAccount(transportId, accountId)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Transport account ${transportId}/${accountId} is configured.`
          }
        ],
        details: {
          manifest,
          account: refreshed ?? saved
        }
      }
    }

    if (action === 'connect_account') {
      const transportId = asTrimmed(input.transportId)
      const accountId = await resolveAccountId(
        gatewayService,
        transportId,
        asTrimmed(input.accountId)
      )
      const account = await gatewayService.connectTransportAccount({
        transportId,
        accountId,
        validate: input.validateAfterSave !== false
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Connected transport account ${transportId}/${accountId}.`
          }
        ],
        details: { account }
      }
    }

    if (action === 'disconnect_account') {
      const transportId = asTrimmed(input.transportId)
      const accountId = await resolveAccountId(
        gatewayService,
        transportId,
        asTrimmed(input.accountId)
      )
      const account = await gatewayService.disconnectTransportAccount({
        transportId,
        accountId,
        disableOnStartup: input.disableOnStartup !== false
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Disconnected transport account ${transportId}/${accountId}.`
          }
        ],
        details: { account }
      }
    }

    throw new Error(`Unknown action: ${String(input.action ?? '')}`)
  }
})
