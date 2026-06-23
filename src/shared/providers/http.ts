const getRequestHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const isNetworkLikeError = (message: string): boolean =>
  /fetch failed|failed to fetch|load failed|networkerror|network error|econnreset|econnrefused|enotfound|etimedout|ssl|tls|certificate|socket|err_/i.test(
    message
  )

const normalizeRequestError = (url: string, error: unknown): Error => {
  const host = getRequestHost(url)
  const message =
    error instanceof Error
      ? [error.message, String((error as Error & { cause?: unknown }).cause ?? '')]
          .filter(Boolean)
          .join(' ')
      : String(error)

  if (isNetworkLikeError(message)) {
    return new Error(
      `网络连接失败：无法连接到 ${host}。请检查当前网络、代理/VPN、DNS 或防火墙设置。`
    )
  }

  return error instanceof Error ? error : new Error(String(error))
}

const formatErrorFromBody = async (res: Response): Promise<string> => {
  const text = await res.text().catch(() => '')
  const reason = text || `${res.status} ${res.statusText}`
  if (res.status === 401 || res.status === 403) {
    return `认证失败 (${res.status})：请检查 API Key 是否正确，或该接口是否已开通权限。\n${reason}`.slice(
      0,
      4000
    )
  }
  if (res.status === 429) {
    return `请求过于频繁 (${res.status})：已触发供应商限流，请稍后重试。\n${reason}`.slice(0, 4000)
  }
  if (res.status >= 500) {
    return `供应商服务暂时不可用 (${res.status})：请稍后重试。\n${reason}`.slice(0, 4000)
  }
  return reason.slice(0, 4000)
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    throw normalizeRequestError(url, error)
  }
  if (!res.ok) {
    throw new Error(await formatErrorFromBody(res))
  }
  return (await res.json()) as T
}
