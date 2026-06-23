import { nanoid } from 'nanoid'

/**
 * 生成简短的随机 ID (默认 16 位)
 * 使用成熟的 nanoid 库
 */
export function generateId(size = 16): string {
  return nanoid(size)
}
