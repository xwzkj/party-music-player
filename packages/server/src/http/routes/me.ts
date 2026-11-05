import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  AppError,
  changeEmailSchema,
  changePasswordSchema,
  changeUsernameSchema,
  neteaseCaptchaRequestSchema,
  neteasePhoneLoginSchema,
  patchMeSchema,
  roomCodeSchema,
} from '@pmp/shared'
import { authService } from '../../auth/authService.ts'
import { toMeView, usersRepo } from '../../db/users.ts'
import { limiter } from '../../infra/rateLimit.ts'
import { neteaseService } from '../../services/neteaseService.ts'
import { roomService } from '../../services/roomService.ts'
import { parse, requireUser, setLoginCookie } from '../helpers.ts'

/** 短信验证码有成本，也防止被拿来刷别人手机号 */
const captchaPerUser = limiter(3, 10 * 60_000)
const phoneLoginPerUser = limiter(10, 10 * 60_000)

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser)

  app.get('/api/me', async (req) => toMeView(req.me))

  app.patch('/api/me', async (req) => {
    const b = parse(patchMeSchema, req.body)
    usersRepo.setNickname(req.me.id, b.nickname)
    roomService.renameEverywhere(req.me.id, b.nickname)
    return toMeView(usersRepo.byId(req.me.id)!)
  })

  app.post('/api/me/password', async (req, reply) => {
    const b = parse(changePasswordSchema, req.body)
    const u = await authService.changePassword(req.me, b.oldPassword, b.newPassword)
    // token_version 已加 1，给当前设备重新签发
    await setLoginCookie(reply, u)
    return toMeView(u)
  })

  app.post('/api/me/email', async (req) => {
    const b = parse(changeEmailSchema, req.body)
    const r = await authService.changeEmail(req.me, b.email, b.code, req.ip)
    return { result: r, me: toMeView(usersRepo.byId(req.me.id)!) }
  })

  app.post('/api/me/username', async (req) => {
    const b = parse(changeUsernameSchema, req.body)
    authService.changeUsername(req.me, b.username)
    return toMeView(usersRepo.byId(req.me.id)!)
  })

  // 网易云绑定
  app.post('/api/netease/login/qr', async (req) => {
    const b = parse(z.object({ showOnHost: roomCodeSchema.optional() }), req.body)
    return neteaseService.createQr(req.me, b.showOnHost)
  })

  app.get('/api/netease/login/qr/:key', async (req) => {
    const p = parse(z.object({ key: z.string().min(1).max(128) }), req.params)
    return neteaseService.checkQr(req.me, p.key)
  })

  // 手机号 + 短信验证码绑定
  app.post('/api/netease/login/captcha', async (req) => {
    const b = parse(neteaseCaptchaRequestSchema, req.body)
    if (!captchaPerUser.take(req.me.id)) throw new AppError('RATE_LIMITED', 429)
    await neteaseService.sendLoginCaptcha(b.phone)
    return { ok: true }
  })

  app.post('/api/netease/login/phone', async (req) => {
    const b = parse(neteasePhoneLoginSchema, req.body)
    if (!phoneLoginPerUser.take(req.me.id)) throw new AppError('RATE_LIMITED', 429)
    return neteaseService.bindByPhone(req.me, b.phone, b.captcha)
  })

  app.get('/api/netease/me', async (req) => neteaseService.me(req.me))
  app.get('/api/netease/me/playlists', async (req) => neteaseService.myPlaylists(req.me))
  app.delete('/api/netease/me', async (req) => {
    neteaseService.unbind(req.me)
    return { ok: true }
  })
}
