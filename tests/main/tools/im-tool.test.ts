import test from 'node:test'
import assert from 'node:assert/strict'
import { createImTool } from '../../../src/main/tools/im-tool.ts'

test('imTool description makes plugin-owned account setup canonical', () => {
  const tool = createImTool({
    gatewayService: {} as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  assert.match(tool.description, /setup_account/)
  assert.match(tool.description, /plugin-declared setup methods/)
})

test('imTool setup_account collects missing non-secret fields through framework form input', async () => {
  const formCalls: unknown[] = []
  const saveCalls: unknown[] = []
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: [
              {
                key: 'appId',
                type: 'text',
                label: 'App ID',
                required: true
              },
              {
                key: 'appSecret',
                type: 'secret',
                label: 'App Secret',
                required: true
              }
            ]
          }
        }
      }),
      listTransportAccounts: async () => [],
      getTransportAccount: async () => null,
      saveTransportAccount: async (input: unknown) => {
        saveCalls.push(input)
        return {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: { appId: 'cli_xxx' },
          hasSecrets: { appSecret: true },
          secrets: {},
          validationStatus: 'unknown',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      },
      setTransportPluginEnabled: async () => ({ pluginId: 'feishu', enabled: true }),
      testTransportAccount: async () => ({
        pluginId: 'feishu',
        accountId: 'default',
        success: true,
        checkedAt: '2026-04-24T00:00:00.000Z'
      })
    } as any,
    interactionController: {
      requestFormInput: async (_context: unknown, form: unknown) => {
        formCalls.push(form)
        return {
          status: 'completed',
          formId: 'transport-config:feishu:default',
          values: { appId: 'cli_xxx' },
          answers: []
        }
      },
      requestSecretInput: async () => ({
        status: 'answered',
        secretId: 'transport-secret:feishu:default:appSecret',
        value: 'secret-xxx'
      })
    } as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  const result = await tool.execute(
    'tool-im-setup',
    {
      action: 'setup_account',
      transportId: 'feishu',
      accountId: 'default'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.equal(formCalls.length, 1)
  assert.equal((formCalls[0] as any).fields[0].key, 'appId')
  assert.equal((saveCalls[0] as any).config.appId, 'cli_xxx')
  assert.equal((saveCalls[0] as any).secrets.appSecret, 'secret-xxx')
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /configured/i)
})

test('imTool setup_account asks for a setup method before starting QR setup', async () => {
  const questionnaireCalls: unknown[] = []
  const setupCalls: unknown[] = []
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'wechat',
        displayName: 'WeChat',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            setupMethods: [
              {
                id: 'wechat_qr_login',
                kind: 'qr',
                label: '扫码登录',
                recommended: true,
                outputConfigKeys: ['accountExternalId', 'baseUrl', 'userId'],
                outputSecretKeys: ['token']
              },
              {
                id: 'manual_ilink_config',
                kind: 'form',
                label: '手动填写 iLink 配置',
                fields: ['accountExternalId', 'token', 'baseUrl']
              }
            ],
            fields: [
              {
                key: 'accountExternalId',
                type: 'text',
                label: 'iLink Bot ID',
                required: true
              },
              {
                key: 'token',
                type: 'secret',
                label: 'iLink Bot Token',
                required: true
              }
            ]
          }
        }
      }),
      listTransportAccounts: async () => [],
      getTransportAccount: async () => null,
      listTransportAccountSetupMethods: async () => [
        {
          id: 'wechat_qr_login',
          kind: 'qr',
          label: '扫码登录',
          recommended: true,
          outputConfigKeys: ['accountExternalId', 'baseUrl', 'userId'],
          outputSecretKeys: ['token']
        },
        {
          id: 'manual_ilink_config',
          kind: 'form',
          label: '手动填写 iLink 配置',
          fields: ['accountExternalId', 'token', 'baseUrl']
        }
      ],
      startTransportAccountSetup: async (input: unknown) => {
        setupCalls.push(input)
        return {
          pluginId: 'wechat',
          accountId: 'default',
          methodId: 'wechat_qr_login',
          sessionId: 'setup-1',
          startedAt: '2026-04-29T00:00:00.000Z',
          expiresAt: '2026-04-29T00:08:00.000Z',
          events: [
            {
              type: 'qr',
              pluginId: 'wechat',
              accountId: 'default',
              methodId: 'wechat_qr_login',
              sessionId: 'setup-1',
              qrUrl: 'https://example.test/qr',
              expiresAt: '2026-04-29T00:08:00.000Z'
            }
          ]
        }
      }
    } as any,
    interactionController: {
      requestQuestionnaireInput: async (_context: unknown, questionnaire: unknown) => {
        questionnaireCalls.push(questionnaire)
        return {
          status: 'completed',
          questionnaireId: 'transport-setup-method:wechat:default',
          answers: [
            {
              stepIndex: 0,
              questionId: 'setupMethod',
              inputKind: 'option',
              optionId: 'wechat_qr_login',
              label: '扫码登录',
              value: 'wechat_qr_login',
              rawInput: '扫码登录'
            }
          ]
        }
      },
      requestFormInput: async () => {
        throw new Error('QR setup should not collect required fields through the manual form')
      },
      requestSecretInput: async () => {
        throw new Error('QR setup should not ask for secrets before the plugin completes setup')
      }
    } as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  const result = await tool.execute(
    'tool-im-setup-wechat',
    {
      action: 'setup_account',
      transportId: 'wechat'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.equal(questionnaireCalls.length, 1)
  assert.equal(
    ((questionnaireCalls[0] as any).questions[0].options[0] as any).id,
    'wechat_qr_login'
  )
  assert.deepEqual(setupCalls, [
    {
      pluginId: 'wechat',
      accountId: 'default',
      methodId: 'wechat_qr_login',
      initialValues: {},
      validateAfterSave: true
    }
  ])
  const toolText = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(toolText, /setup-1/)
  assert.match(toolText, /scan the QR with WeChat/i)
  assert.doesNotMatch(toolText, /chat UI/i)
  assert.doesNotMatch(toolText, /desktop UI/i)
  assert.doesNotMatch(toolText, /QR login card/i)
  assert.doesNotMatch(toolText, /rendered QR card/i)
  assert.match(toolText, /Do not repeat the QR image, link, QR text, or expiry/i)
  assert.doesNotMatch(toolText, /!\[WeChat setup QR code\]/)
  assert.doesNotMatch(toolText, /https:\/\/example\.test\/qr/)
  assert.doesNotMatch(toolText, /QR code link:/)
  assert.doesNotMatch(toolText, /QR text:/)
  assert.doesNotMatch(toolText, /Expires at 2026-04-29T00:08:00\.000Z/)
  assert.equal((result.details as any).session.sessionId, 'setup-1')
})

test('imTool list_targets infers the only configured account for a transport', async () => {
  const listTargetCalls: unknown[] = []
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        displayName: 'Feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: []
          }
        }
      }),
      listTransportAccounts: async () => [
        {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: {},
          hasSecrets: {},
          secrets: {},
          validationStatus: 'validated',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      listImTargets: async (input: unknown) => {
        listTargetCalls.push(input)
        return [
          {
            transportId: 'feishu',
            transportAccountId: 'default',
            externalChatId: 'oc_ops',
            channelKind: 'group',
            title: 'Ops Group',
            source: 'plugin',
            routingKey: 'feishu:default:oc_ops:-:group',
            bindingId: null,
            conversationId: null,
            conversationTitle: null,
            activeOnConversation: false
          }
        ]
      }
    } as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  const result = await tool.execute(
    'tool-im-list-targets',
    {
      action: 'list_targets',
      transportId: 'feishu',
      channelKind: 'group',
      limit: 50
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.deepEqual(listTargetCalls, [
    {
      transportId: 'feishu',
      accountId: 'default',
      query: null,
      limit: 50,
      channelKind: 'group'
    }
  ])
  assert.match(result.content[0]?.type === 'text' ? result.content[0].text : '', /Ops Group/)
})

test('imTool list_targets labels route binding ids as internal-only metadata', async () => {
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        displayName: 'Feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: []
          }
        }
      }),
      listTransportAccounts: async () => [
        {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: {},
          hasSecrets: {},
          secrets: {},
          validationStatus: 'validated',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      listImTargets: async () => [
        {
          transportId: 'feishu',
          transportAccountId: 'default',
          externalChatId: 'oc_ops',
          externalThreadId: null,
          externalUserId: null,
          channelKind: 'group',
          title: 'Ops Group',
          description: 'feishu:default',
          source: 'binding',
          routingKey: 'feishu:default:oc_ops:-:group',
          bindingId: 'jwUtqAapv8i-lH-i',
          conversationId: 'conversation-ops',
          conversationTitle: 'Ops Group',
          activeOnConversation: true
        }
      ]
    } as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  const result = await tool.execute(
    'tool-im-list-targets-route',
    {
      action: 'list_targets',
      transportId: 'feishu',
      channelKind: 'group'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.doesNotMatch(text, /\[route /)
  assert.match(text, /externalChatId=oc_ops/)
  assert.match(text, /bindingId=jwUtqAapv8i-lH-i/)
  assert.match(text, /PiAgent internal route id; use only as bindingId/)
})

test('imTool list_targets recommends externalUserId only for direct user targets', async () => {
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        displayName: 'Feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: []
          }
        }
      }),
      listTransportAccounts: async () => [
        {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: {},
          hasSecrets: {},
          secrets: {},
          validationStatus: 'validated',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      listImTargets: async () => [
        {
          transportId: 'feishu',
          transportAccountId: 'default',
          externalChatId: 'ou_alice',
          externalThreadId: null,
          externalUserId: 'ou_alice',
          channelKind: 'dm',
          title: 'Alice',
          description: 'direct open_id receiver',
          source: 'plugin',
          targetKind: 'contact',
          routingKey: 'feishu:default:ou_alice:-:dm',
          bindingId: null,
          conversationId: null,
          conversationTitle: null,
          activeOnConversation: false
        }
      ]
    } as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  const result = await tool.execute(
    'tool-im-list-targets-dm',
    {
      action: 'list_targets',
      transportId: 'feishu',
      channelKind: 'dm'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  assert.match(text, /externalUserId=ou_alice/)
  assert.doesNotMatch(text, /externalChatId=ou_alice/)
  assert.equal((result.details as any).targets[0].recommendedSendArgs.externalUserId, 'ou_alice')
  assert.equal((result.details as any).targets[0].recommendedSendArgs.externalChatId, undefined)
})

test('imTool send_message infers the only configured account and avoids duplicated direct user chat ids', async () => {
  const sendCalls: unknown[] = []
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        displayName: 'Feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: []
          }
        }
      }),
      listTransportAccounts: async () => [
        {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: {},
          hasSecrets: {},
          secrets: {},
          validationStatus: 'validated',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      sendImMessage: async (input: unknown) => {
        sendCalls.push(input)
        return {
          binding: {
            transportId: 'feishu',
            transportAccountId: 'default',
            externalChatId: 'ou_alice',
            externalThreadId: null
          }
        }
      }
    } as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  await tool.execute(
    'tool-im-send-dm',
    {
      action: 'send_message',
      transportId: 'feishu',
      externalChatId: 'ou_alice',
      externalUserId: 'ou_alice',
      text: 'hello'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.equal((sendCalls[0] as any).accountId, 'default')
  assert.equal((sendCalls[0] as any).externalUserId, 'ou_alice')
  assert.equal((sendCalls[0] as any).externalChatId, null)
})

test('imTool send_message treats Feishu ou receiver in externalChatId as a direct user id', async () => {
  const sendCalls: unknown[] = []
  const tool = createImTool({
    gatewayService: {
      getTransportPluginManifest: async () => ({
        id: 'feishu',
        displayName: 'Feishu',
        contributes: {
          settings: {
            scope: 'transport_account',
            supportsMultipleAccounts: false,
            fields: []
          }
        }
      }),
      listTransportAccounts: async () => [
        {
          pluginId: 'feishu',
          accountId: 'default',
          enabled: true,
          config: {},
          hasSecrets: {},
          secrets: {},
          validationStatus: 'validated',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      sendImMessage: async (input: unknown) => {
        sendCalls.push(input)
        return {
          binding: {
            transportId: 'feishu',
            transportAccountId: 'default',
            externalChatId: 'ou_alice',
            externalThreadId: null
          }
        }
      }
    } as any,
    interactionController: {} as any,
    context: {
      conversationId: 'conversation-1',
      interactionThreadId: 'thread-1',
      interactionController: {} as any
    }
  })

  await tool.execute(
    'tool-im-send-dm-ou-chat-id',
    {
      action: 'send_message',
      transportId: 'feishu',
      externalChatId: 'ou_alice',
      text: 'hello'
    } as any,
    undefined,
    undefined,
    {} as any
  )

  assert.equal((sendCalls[0] as any).accountId, 'default')
  assert.equal((sendCalls[0] as any).externalUserId, 'ou_alice')
  assert.equal((sendCalls[0] as any).externalChatId, null)
})
