import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import { AppError } from '@pmp/shared'
import { authService, jwtTtlSec } from '../auth/authService.ts'
import { config } from '../config.ts'
import type { UserRow } from '../db/users.ts'

declare module 'fastify' {
  interface FastifyRequest {
    me: UserRow
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { uid: string; tv: number }
    user: { uid: string; tv: number }
  }
}

export const COOKIE_NAME = 'token'

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {})
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? '输入不合法'
    throw new AppError('VALIDATION_FAILED', 400, msg)
  }
  return r.data
}

/** 允许在"必须改密码"状态下访问的路径 */
const ALLOWED_WHEN_MUST_CHANGE = new Set(['/api/me', '/api/me/password', '/api/me/username', '/api/auth/logout'])

async function resolveUser(req: FastifyRequest): Promise<UserRow> {
  try {
    await req.jwtVerify()
  } catch {
    throw new AppError('UNAUTHORIZED', 401)
  }
  const u = authService.userFromToken(req.user.uid, req.user.tv)
  if (!u) throw new AppError('UNAUTHORIZED', 401)
  return u
}

/** preHandler：要求登录；必须改密码时只放行少数接口 */
export async function requireUser(req: FastifyRequest): Promise<void> {
  const u = await resolveUser(req)
  const path = req.routeOptions.url ?? req.url
  if (u.must_change_password && !ALLOWED_WHEN_MUST_CHANGE.has(path)) {
    throw new AppError('MUST_CHANGE_PASSWORD', 403)
  }
  req.me = u
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  await requireUser(req)
  if (req.me.role !== 'admin') throw new AppError('FORBIDDEN', 403)
}

export async function setLoginCookie(reply: FastifyReply, u: UserRow): Promise<void> {
  const token = await reply.jwtSign({ uid: u.id, tv: u.token_version }, { expiresIn: jwtTtlSec })
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: jwtTtlSec,
  })
}

export function clearLoginCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' })
}
