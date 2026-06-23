import { isIP } from 'node:net'

const normalizeHostname = (hostname: string): string =>
  hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets
}

const isPrivateIpv4 = (hostname: string): boolean => {
  const octets = parseIpv4(hostname)
  if (!octets) return false
  const [a, b] = octets
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

const isPrivateIpv6 = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

const isBlockedHostname = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (normalized === 'metadata.google.internal') return true

  const ipVersion = isIP(normalized)
  if (ipVersion === 4) return isPrivateIpv4(normalized)
  if (ipVersion === 6) return isPrivateIpv6(normalized)
  return false
}

export const normalizeWebFetchUrl = (rawUrl: string): string => {
  const input = String(rawUrl ?? '').trim()
  if (!input) throw new Error('Invalid URL: URL is required')

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`Invalid URL: ${input}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed for WebFetch')
  }

  return url.toString()
}

export const assertSafeWebFetchUrl = (rawUrl: string): string => {
  const normalized = normalizeWebFetchUrl(rawUrl)
  const url = new URL(normalized)
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`WebFetch URL is not allowed: ${url.hostname}`)
  }
  return normalized
}
