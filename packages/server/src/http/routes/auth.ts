import type { FastifyInstance } from 'fastify'
import {
  emailCodeRequestSchema,
  loginSchema,
  registerSchema,
  resetConfirmSchema,
  resetRequestSchema,
  type PublicConfig,
} from '@pmp/shared'
import { authService } from '../../auth/authService.ts'
import { emailVerificationEnabled } from '../../auth/mailer.ts'
import { turnstileEnabled } from '../../auth/turnstile.ts'
import { config } from '../../config.ts'
import { toMeView } from '../../db/users.ts'
import { clearLoginCookie, parse, setLoginCookie } from '../helpers.ts'

const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } })

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async (): Promise<PublicConfig> => {
    const ts = turnstileEnabled()
    return {
      emailVerificationEnabled: emailVerificationEnabled(),
      turnstileEnabled: ts,
      turnstileSiteKey: ts ? config.turnstile.siteKey : null,
    }
  })

  app.post('/api/auth/email-code', limit(10, '1 hour'), async (req) => {
    const b = parse(emailCodeRequestSchema, req.body)
    await authService.sendRegisterCode(b.email, b.turnstileToken, req.ip)
    return { ok: true }
  })

  app.post('/api/auth/register', limit(20, '1 hour'), async (req, reply) => {
    const b = parse(registerSchema, req.body)
    const u = await authService.register(b, req.ip)
    await setLoginCookie(reply, u)
    return toMeView(u)
  })

  app.post('/api/auth/login', limit(10, '1 minute'), async (req, reply) => {
    const b = parse(loginSchema, req.body)
    const u = await authService.login(b.username, b.password)
    await setLoginCookie(reply, u)
    return toMeView(u)
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    clearLoginCookie(reply)
    return { ok: true }
  })

  app.post('/api/auth/password-reset/request', limit(10, '1 hour'), async (req) => {
    const b = parse(resetRequestSchema, req.body)
    await authService.requestReset(b.account, b.turnstileToken, req.ip)
    return { ok: true }
  })

  app.post('/api/auth/password-reset/confirm', limit(10, '10 minutes'), async (req) => {
    const b = parse(resetConfirmSchema, req.body)
    await authService.confirmReset(b.account, b.code, b.password)
    return { ok: true }
  })
}
