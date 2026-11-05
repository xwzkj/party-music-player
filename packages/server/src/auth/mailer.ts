import nodemailer from 'nodemailer'
import { AppError } from '@pmp/shared'
import { config } from '../config.ts'
import { SettingKey, settingsRepo } from '../db/settings.ts'
import { logger } from '../infra/logger.ts'

export const smtpConfigured = (): boolean => !!(config.smtp.host && config.smtp.from)

export const emailVerificationEnabled = (): boolean =>
  smtpConfigured() && settingsRepo.getBool(SettingKey.emailVerification, false)

let transport: nodemailer.Transporter | null = null
function getTransport(): nodemailer.Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  }
  return transport
}

/** 测试时替换发信实现 */
export let sendMail = async (to: string, subject: string, text: string): Promise<void> => {
  if (!smtpConfigured()) throw new AppError('FEATURE_DISABLED')
  try {
    await getTransport().sendMail({ from: config.smtp.from, to, subject, text })
  } catch (e) {
    logger.error({ err: String(e) }, 'send mail failed')
    throw new AppError('INTERNAL', 500, '邮件发送失败')
  }
}

export function setSendMail(fn: typeof sendMail): void {
  sendMail = fn
}
