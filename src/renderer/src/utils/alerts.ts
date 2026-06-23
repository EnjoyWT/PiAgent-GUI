import { globalDialog } from './dialog'

type BoxOptions = {
  title?: string
  message: string
  detail?: string
}

// Centralized error notifier used by settings and other UI parts.
export const showError = ({ title = '请求失败', message, detail }: BoxOptions) => {
  const fullMessage = detail ? `${message}\n\n${detail}` : message

  void globalDialog.alert({ title, message: fullMessage })
}
