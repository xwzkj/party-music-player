import { AppError } from '@pmp/shared'
import { config } from '../config.ts'
import { SettingKey, settingsRepo } from '../db/settings.ts'
import { logger } from '../infra/logger.ts'

export const turnstileConfigured = (): boolean => !!(config.turnstile.siteKey && config.turnstile.secretKey)

export const turnstileEnabled = (): boolean =>
  turnstileConfigured() && settingsRepo.getBool(SettingKey.turnstile, false)

/** 打开 Turnstile 时调用 siteverify 核验；关闭时直接通过 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  if (!turnstileEnabled()) return
  if (!token) throw new AppError('TURNSTILE_FAILED')
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.turnstile.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    })
    const data = (await res.json()) as { success?: boolean }
    if (!data.success) throw new AppError('TURNSTILE_FAILED')
  } catch (e) {
    if (e instanceof AppError) throw e
    logger.warn({ err: String(e) }, 'turnstile verify failed')
    throw new AppError('TURNSTILE_FAILED')
  }
}
