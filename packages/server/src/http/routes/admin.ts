import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, adminCreateUserSchema, adminPatchUserSchema, adminSettingsSchema, idSchema, testEmailSchema } from '@pmp/shared'
import { authService } from '../../auth/authService.ts'
import { sendMail, smtpConfigured } from '../../auth/mailer.ts'
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

  app.patch('/api/admin/settings', async (req) => {
    const b = parse(adminSettingsSchema, req.body)
    if (b.emailVerificationEnabled !== undefined) {
      if (b.emailVerificationEnabled && !smtpConfigured()) {
        throw new AppError('FEATURE_DISABLED', 400, '请先在环境变量里配置 SMTP')
      }
      settingsRepo.setBool(SettingKey.emailVerification, b.emailVerificationEnabled)
    }
    if (b.turnstileEnabled !== undefined) {
      if (b.turnstileEnabled && !turnstileConfigured()) {
        throw new AppError('FEATURE_DISABLED', 400, '请先在环境变量里配置 Turnstile 密钥')
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
