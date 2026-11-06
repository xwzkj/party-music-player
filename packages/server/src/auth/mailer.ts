import nodemailer from 'nodemailer'
import { AppError } from '@pmp/shared'
import { SettingKey, settingsRepo } from '../db/settings.ts'
import { logger } from '../infra/logger.ts'
import { smtpSettings } from './runtimeConfig.ts'

export const smtpConfigured = (): boolean => {
  const c = smtpSettings()
  return !!(c.host && c.from)
}

export const emailVerificationEnabled = (): boolean =>
  smtpConfigured() && settingsRepo.getBool(SettingKey.emailVerification, false)

/** 配置可能随时在后台修改，所以每次发信都按当前配置创建 transport */
function createTransport(): nodemailer.Transporter {
  const c = smtpSettings()
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user ? { user: c.user, pass: c.pass } : undefined,
  })
}

/** 测试时替换发信实现 */
export let sendMail = async (to: string, subject: string, text: string): Promise<void> => {
  if (!smtpConfigured()) throw new AppError('FEATURE_DISABLED')
  try {
    await createTransport().sendMail({ from: smtpSettings().from, to, subject, text })
  } catch (e) {
    logger.error({ err: String(e) }, 'send mail failed')
    throw new AppError('INTERNAL', 500, '邮件发送失败，请检查 SMTP 配置')
  }
}

export function setSendMail(fn: typeof sendMail): void {
  sendMail = fn
}
