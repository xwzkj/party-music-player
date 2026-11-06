import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  AppError,
  adminCreateUserSchema,
  adminIntegrationsSchema,
  adminPatchUserSchema,
  adminSettingsSchema,
  idSchema,
  testEmailSchema,
} from '@pmp/shared'
import { authService } from '../../auth/authService.ts'
import { sendMail, smtpConfigured } from '../../auth/mailer.ts'
import { saveOrClear, smtpSettings, turnstileSettings } from '../../auth/runtimeConfig.ts'
import { turnstileConfigured } from '../../auth/turnstile.ts'
import { neteaseRepo } from '../../db/netease.ts'
import { SettingKey, settingsRepo } from '../../db/settings.ts'
import { toMeView, usersRepo } from '../../db/users.ts'
import { roomService } from '../../services/roomService.ts'
import { parse, requireAdmin } from '../helpers.ts'

const idParam = z.object({ id: idSchema })

function adminView(id: string) {
  const u = usersRepo.byId(id)
  if (!u) throw new AppError('NOT_FOUND', 404)
  return { ...toMeView(u), createdAt: u.created_at, neteaseBound: !!neteaseRepo.get(u.id) }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin)

  app.get('/api/admin/users', async () => usersRepo.list().map((u) => adminView(u.id)))

  app.get('/api/admin/users/:id', async (req) => adminView(parse(idParam, req.params).id))

  app.post('/api/admin/users', async (req) => {
    const b = parse(adminCreateUserSchema, req.body)
    const u = await authService.adminCreateUser(b)
    return adminView(u.id)
  })

  app.patch('/api/admin/users/:id', async (req) => {
    const { id } = parse(idParam, req.params)
    const b = parse(adminPatchUserSchema, req.body)
    const u = usersRepo.byId(id)
    if (!u) throw new AppError('NOT_FOUND', 404)
    if (b.nickname !== undefined) {
      usersRepo.setNickname(id, b.nickname)
      roomService.renameEverywhere(id, b.nickname)
    }
    if (b.canCreateRoom !== undefined && u.role !== 'admin') usersRepo.setCanCreateRoom(id, b.canCreateRoom)
    if (b.email !== undefined) usersRepo.setEmail(id, b.email, false)
    if (b.password !== undefined) await authService.adminResetPassword(id, b.password)
    return adminView(id)
  })

  app.delete('/api/admin/users/:id', async (req) => {
    const { id } = parse(idParam, req.params)
    const u = usersRepo.byId(id)
    if (!u) throw new AppError('NOT_FOUND', 404)
    if (u.role === 'admin') throw new AppError('FORBIDDEN', 403, '不能删除管理员')
    roomService.purgeUser(id)
    authService.deleteUser(id)
    return { ok: true }
  })

  app.get('/api/admin/settings', async () => ({
    emailVerificationEnabled: settingsRepo.getBool(SettingKey.emailVerification),
    turnstileEnabled: settingsRepo.getBool(SettingKey.turnstile),
    smtpConfigured: smtpConfigured(),
    turnstileConfigured: turnstileConfigured(),
  }))

  /** SMTP 与 Turnstile 的当前生效配置。密码和密钥不回传，只告诉前端是否已设置 */
  app.get('/api/admin/integrations', async () => {
    const smtp = smtpSettings()
    const ts = turnstileSettings()
    return {
      smtp: {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        from: smtp.from,
        passSet: !!smtp.pass,
      },
      turnstile: { siteKey: ts.siteKey, secretSet: !!ts.secretKey },
    }
  })

  app.put('/api/admin/integrations', async (req) => {
    const b = parse(adminIntegrationsSchema, req.body)
    if (b.smtpHost !== undefined) saveOrClear(SettingKey.smtpHost, b.smtpHost)
    if (b.smtpPort !== undefined) settingsRepo.set(SettingKey.smtpPort, String(b.smtpPort))
    if (b.smtpSecure !== undefined) settingsRepo.setBool(SettingKey.smtpSecure, b.smtpSecure)
    if (b.smtpUser !== undefined) saveOrClear(SettingKey.smtpUser, b.smtpUser)
    if (b.smtpPass !== undefined) saveOrClear(SettingKey.smtpPass, b.smtpPass)
    if (b.smtpFrom !== undefined) saveOrClear(SettingKey.smtpFrom, b.smtpFrom)
    if (b.turnstileSiteKey !== undefined) saveOrClear(SettingKey.turnstileSiteKey, b.turnstileSiteKey)
    if (b.turnstileSecretKey !== undefined) saveOrClear(SettingKey.turnstileSecretKey, b.turnstileSecretKey)
    // 配置被清掉后，依赖它的开关自动关闭，避免留下一个打不开也关不掉的状态
    if (!smtpConfigured()) settingsRepo.setBool(SettingKey.emailVerification, false)
    if (!turnstileConfigured()) settingsRepo.setBool(SettingKey.turnstile, false)
    return { ok: true }
  })

  app.patch('/api/admin/settings', async (req) => {
    const b = parse(adminSettingsSchema, req.body)
    if (b.emailVerificationEnabled !== undefined) {
      if (b.emailVerificationEnabled && !smtpConfigured()) {
        throw new AppError('FEATURE_DISABLED', 400, '请先配置 SMTP')
      }
      settingsRepo.setBool(SettingKey.emailVerification, b.emailVerificationEnabled)
    }
    if (b.turnstileEnabled !== undefined) {
      if (b.turnstileEnabled && !turnstileConfigured()) {
        throw new AppError('FEATURE_DISABLED', 400, '请先配置 Turnstile 站点密钥和私钥')
      }
      settingsRepo.setBool(SettingKey.turnstile, b.turnstileEnabled)
    }
    return { ok: true }
  })

  app.post('/api/admin/settings/test-email', async (req) => {
    const b = parse(testEmailSchema, req.body)
    await sendMail(b.to, '聚会音乐播放器 测试邮件', '收到这封邮件说明 SMTP 配置可用。')
    return { ok: true }
  })
}
