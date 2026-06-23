export type JsonRecord = Record<string, any>

// Simple GET with API key header; throws on non-2xx.
export async function getJsonWithApiKey<T extends JsonRecord = JsonRecord>(
  url: string,
  apiKey: string,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'x-goog-api-key': apiKey,
      ...extraHeaders
    }
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const reason = text || `${res.status} ${res.statusText}`
    throw new Error(reason)
  }

  return (await res.json()) as T
}
