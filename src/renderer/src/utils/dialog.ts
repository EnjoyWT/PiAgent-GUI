import { reactive, readonly } from 'vue'

export type DialogKind = 'alert' | 'confirm'

export type DialogOptions = {
  title?: string
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type DialogState = {
  open: boolean
  kind: DialogKind
  title: string
  message: string
  detail: string
  confirmText: string
  cancelText: string
  danger: boolean
}

const state = reactive<DialogState>({
  open: false,
  kind: 'alert',
  title: '',
  message: '',
  detail: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false
})

let resolveCurrent: ((v: boolean) => void) | null = null

const close = (result: boolean) => {
  const resolver = resolveCurrent
  resolveCurrent = null
  state.open = false
  if (resolver) resolver(result)
}

const open = (kind: DialogKind, opts: DialogOptions): Promise<boolean> => {
  // Resolve any previous dialog (rare but avoids dangling promises).
  if (resolveCurrent) close(false)

  state.kind = kind
  state.title = (opts.title ?? (kind === 'confirm' ? '请确认' : '提示')).trim()
  state.message = String(opts.message ?? '').trim()
  state.detail = String(opts.detail ?? '').trim()
  state.confirmText = (opts.confirmText ?? (kind === 'confirm' ? '确定' : '知道了')).trim()
  state.cancelText = (opts.cancelText ?? '取消').trim()
  state.danger = Boolean(opts.danger)
  state.open = true

  return new Promise<boolean>((resolve) => {
    resolveCurrent = resolve
  })
}

export const globalDialog = {
  state: readonly(state),
  close,
  alert: async (opts: DialogOptions): Promise<void> => {
    await open('alert', opts)
  },
  confirm: (opts: DialogOptions): Promise<boolean> => open('confirm', opts)
}
