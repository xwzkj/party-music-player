import { randomBytes, randomInt, randomUUID, timingSafeEqual, createHash } from 'node:crypto'

export const newId = (): string => randomUUID()

export function randomDigits(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += String(randomInt(0, 10))
  return s
}

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
export function randomPassword(len = 16): string {
  const bytes = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += PW_CHARS[bytes[i] % PW_CHARS.length]
  return s
}

/** 定长比较，防止计时攻击；先哈希成等长再比 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
