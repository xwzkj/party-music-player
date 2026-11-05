import { AppError } from '@pmp/shared'
import { limiter } from '../infra/rateLimit.ts'
import { randomDigits, safeEqual } from '../infra/ids.ts'

/** 邮箱验证码与重置码：只放内存，10 分钟有效，最多试 5 次 */
interface CodeEntry {
  code: string
  expiresAt: number
  attempts: number
}

const TTL = 10 * 60_000
const MAX_ATTEMPTS = 5
const store = new Map<string, CodeEntry>()

const perTarget = limiter(1, 60_000)
const perIp = limiter(10, 60 * 60_000)

export type CodePurpose = 'register' | 'reset' | 'email'

/** 检查发送频率并生成验证码；同一目标 60 秒一次，同一 IP 每小时 10 次 */
export function issueCode(purpose: CodePurpose, target: string, ip: string): string {
  const key = `${purpose}:${target.toLowerCase()}`
  if (!perTarget.check(key) || !perIp.check(ip)) throw new AppError('RATE_LIMITED', 429)
  perTarget.take(key)
  perIp.take(ip)
  const code = randomDigits(6)
  store.set(key, { code, expiresAt: Date.now() + TTL, attempts: 0 })
  return code
}

/** 校验并消费验证码 */
export function consumeCode(purpose: CodePurpose, target: string, code: string | undefined): void {
  const key = `${purpose}:${target.toLowerCase()}`
  const e = store.get(key)
  if (!e || !code || Date.now() > e.expiresAt || e.attempts >= MAX_ATTEMPTS) {
    throw new AppError('EMAIL_CODE_INVALID')
  }
  e.attempts++
  if (!safeEqual(e.code, code)) throw new AppError('EMAIL_CODE_INVALID')
  store.delete(key)
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of store) if (now > v.expiresAt) store.delete(k)
}, 60_000).unref()
