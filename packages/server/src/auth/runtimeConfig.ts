import { config } from '../config.ts'
import { SettingKey, settingsRepo } from '../db/settings.ts'

/**
 * SMTP 与 Turnstile 的生效配置：管理员在后台保存的值优先，没有就用环境变量。
 * 每次调用都重新读取，后台改完立即生效，不用重启。
 */

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

export function smtpSettings(): SmtpSettings {
  const port = Number(settingsRepo.get(SettingKey.smtpPort))
  const user = settingsRepo.get(SettingKey.smtpUser) ?? config.smtp.user
  return {
    host: settingsRepo.get(SettingKey.smtpHost) ?? config.smtp.host,
    port: Number.isInteger(port) && port > 0 ? port : config.smtp.port,
    secure: settingsRepo.has(SettingKey.smtpSecure) ? settingsRepo.getBool(SettingKey.smtpSecure) : config.smtp.secure,
    user,
    pass: settingsRepo.get(SettingKey.smtpPass) ?? config.smtp.pass,
    from: settingsRepo.get(SettingKey.smtpFrom) ?? (config.smtp.from || user),
  }
}

export interface TurnstileSettings {
  siteKey: string
  secretKey: string
}

export function turnstileSettings(): TurnstileSettings {
  return {
    siteKey: settingsRepo.get(SettingKey.turnstileSiteKey) ?? config.turnstile.siteKey,
    secretKey: settingsRepo.get(SettingKey.turnstileSecretKey) ?? config.turnstile.secretKey,
  }
}

/** 空字符串表示清除后台的值，退回环境变量 */
export function saveOrClear(key: string, value: string): void {
  if (value === '') settingsRepo.delete(key)
  else settingsRepo.set(key, value)
}
