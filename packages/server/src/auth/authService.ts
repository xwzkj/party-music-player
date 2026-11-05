import { AppError } from '@pmp/shared'
import { config } from '../config.ts'
import { tx } from '../db/connection.ts'
import { neteaseRepo } from '../db/netease.ts'
import { roomsRepo } from '../db/rooms.ts'
import { usersRepo, type UserRow } from '../db/users.ts'
import { newId, randomPassword } from '../infra/ids.ts'
import { limiter } from '../infra/rateLimit.ts'
import { logger } from '../infra/logger.ts'
import { consumeCode, issueCode } from './codes.ts'
import { emailVerificationEnabled, sendMail } from './mailer.ts'
import { dummyVerify, hashPassword, verifyPassword } from './password.ts'
import { verifyTurnstile } from './turnstile.ts'

const registerPerIp = limiter(5, 60 * 60_000)
const loginFailures = limiter(10, 15 * 60_000)
const lockedUntil = new Map<string, number>()

export const authService = {
  /** 首次启动：用户表为空时创建管理员，随机密码只打印一次 */
  async ensureAdmin(): Promise<void> {
    if (usersRepo.count() > 0) return
    const password = randomPassword(16)
    usersRepo.insert({
      id: newId(),
      username: 'admin',
      password_hash: await hashPassword(password),
      email: null,
      email_verified: 0,
      nickname: null,
      role: 'admin',
      can_create_room: 1,
      must_change_password: 1,
      can_rename_once: 1,
      created_at: Date.now(),
    })
    const line = '='.repeat(60)
    console.log(`\n${line}\n已创建管理员账号\n  用户名：admin\n  初始密码：${password}\n首次登录后必须修改密码。此密码只显示这一次。\n${line}\n`)
  },

  async sendRegisterCode(email: string, turnstileToken: string | undefined, ip: string): Promise<void> {
    if (!emailVerificationEnabled()) throw new AppError('FEATURE_DISABLED')
    await verifyTurnstile(turnstileToken, ip)
    if (usersRepo.byVerifiedEmail(email)) {
      // 不暴露邮箱是否被占用：照常返回，但不发信
      return
    }
    const code = issueCode('register', email, ip)
    await sendMail(email, '聚会音乐播放器 注册验证码', `你的验证码是 ${code}，10 分钟内有效。`)
  },

  async register(
    input: { username: string; password: string; email?: string; emailCode?: string; turnstileToken?: string },
    ip: string,
  ): Promise<UserRow> {
    if (!registerPerIp.check(ip)) throw new AppError('RATE_LIMITED', 429)
    const verify = emailVerificationEnabled()
    if (verify) {
      if (!input.email) throw new AppError('VALIDATION_FAILED', 400, '请填写邮箱')
      consumeCode('register', input.email, input.emailCode)
    } else {
      await verifyTurnstile(input.turnstileToken, ip)
    }
    if (usersRepo.byUsername(input.username)) throw new AppError('USERNAME_TAKEN', 409)
    if (verify && input.email && usersRepo.byVerifiedEmail(input.email)) {
      throw new AppError('VALIDATION_FAILED', 409, '邮箱已被使用')
    }
    const hash = await hashPassword(input.password)
    // await 之后重新检查
    if (usersRepo.byUsername(input.username)) throw new AppError('USERNAME_TAKEN', 409)
    const id = newId()
    usersRepo.insert({
      id,
      username: input.username,
      password_hash: hash,
      email: input.email ?? null,
      email_verified: verify ? 1 : 0,
      nickname: null,
      role: 'user',
      can_create_room: 0,
      must_change_password: 0,
      can_rename_once: 0,
      created_at: Date.now(),
    })
    registerPerIp.take(ip)
    return usersRepo.byId(id)!
  },

  async login(username: string, password: string): Promise<UserRow> {
    const key = username.toLowerCase()
    const until = lockedUntil.get(key)
    if (until && until > Date.now()) throw new AppError('ACCOUNT_LOCKED', 429)
    const u = usersRepo.byUsername(username)
    if (!u) {
      await dummyVerify(password)
      throw new AppError('BAD_CREDENTIALS', 401)
    }
    if (!(await verifyPassword(password, u.password_hash))) {
      if (loginFailures.hit(key) >= 10) {
        lockedUntil.set(key, Date.now() + 15 * 60_000)
        loginFailures.reset(key)
      }
      throw new AppError('BAD_CREDENTIALS', 401)
    }
    loginFailures.reset(key)
    lockedUntil.delete(key)
    return u
  },

  /** 不管账号是否存在都返回同样的结果 */
  async requestReset(account: string, turnstileToken: string | undefined, ip: string): Promise<void> {
    if (!emailVerificationEnabled()) throw new AppError('FEATURE_DISABLED')
    await verifyTurnstile(turnstileToken, ip)
    const u = account.includes('@') ? usersRepo.byVerifiedEmail(account) : usersRepo.byUsername(account)
    if (!u || !u.email || !u.email_verified) return
    const code = issueCode('reset', u.id, ip)
    sendMail(u.email, '聚会音乐播放器 重置密码', `你的重置码是 ${code}，10 分钟内有效。如果不是你本人操作，请忽略。`).catch(
      (e) => logger.warn({ err: String(e) }, 'reset mail failed'),
    )
  },

  async confirmReset(account: string, code: string, password: string): Promise<void> {
    if (!emailVerificationEnabled()) throw new AppError('FEATURE_DISABLED')
    const u = account.includes('@') ? usersRepo.byVerifiedEmail(account) : usersRepo.byUsername(account)
    if (!u) throw new AppError('EMAIL_CODE_INVALID')
    consumeCode('reset', u.id, code)
    usersRepo.setPassword(u.id, await hashPassword(password))
  },

  async changePassword(u: UserRow, oldPassword: string, newPassword: string): Promise<UserRow> {
    if (!(await verifyPassword(oldPassword, u.password_hash))) throw new AppError('BAD_CREDENTIALS', 400, '原密码错误')
    usersRepo.setPassword(u.id, await hashPassword(newPassword))
    return usersRepo.byId(u.id)!
  },

  /** 开启邮箱验证时：不带 code 先发验证码，带 code 再确认；关闭时直接保存为未验证 */
  async changeEmail(u: UserRow, email: string, code: string | undefined, ip: string): Promise<'sent' | 'saved'> {
    if (!emailVerificationEnabled()) {
      usersRepo.setEmail(u.id, email, false)
      return 'saved'
    }
    const other = usersRepo.byVerifiedEmail(email)
    if (other && other.id !== u.id) throw new AppError('VALIDATION_FAILED', 409, '邮箱已被使用')
    if (!code) {
      const c = issueCode('email', `${u.id}:${email}`, ip)
      await sendMail(email, '聚会音乐播放器 验证邮箱', `你的验证码是 ${c}，10 分钟内有效。`)
      return 'sent'
    }
    consumeCode('email', `${u.id}:${email}`, code)
    usersRepo.setEmail(u.id, email, true)
    return 'saved'
  },

  changeUsername(u: UserRow, username: string): void {
    if (!u.can_rename_once) throw new AppError('FORBIDDEN', 403)
    const other = usersRepo.byUsername(username)
    if (other && other.id !== u.id) throw new AppError('USERNAME_TAKEN', 409)
    usersRepo.setUsername(u.id, username)
  },

  /** 校验 JWT 里的 uid 与 token_version */
  userFromToken(uid: unknown, tv: unknown): UserRow | null {
    if (typeof uid !== 'string' || typeof tv !== 'number') return null
    const u = usersRepo.byId(uid)
    if (!u || u.token_version !== tv) return null
    return u
  },

  async adminCreateUser(input: { username: string; password: string; nickname?: string; canCreateRoom?: boolean }) {
    if (usersRepo.byUsername(input.username)) throw new AppError('USERNAME_TAKEN', 409)
    const id = newId()
    usersRepo.insert({
      id,
      username: input.username,
      password_hash: await hashPassword(input.password),
      email: null,
      email_verified: 0,
      nickname: input.nickname ?? null,
      role: 'user',
      can_create_room: input.canCreateRoom ? 1 : 0,
      must_change_password: 1,
      can_rename_once: 0,
      created_at: Date.now(),
    })
    return usersRepo.byId(id)!
  },

  async adminResetPassword(id: string, password: string): Promise<void> {
    usersRepo.adminResetPassword(id, await hashPassword(password))
  },

  /** 删除账号：先由调用方关闭其房间，这里删除网易云绑定与账号 */
  deleteUser(id: string): void {
    tx(() => {
      neteaseRepo.delete(id)
      roomsRepo.deleteByOwner(id)
      usersRepo.delete(id)
    })
  },
}

export const jwtTtlSec = Math.floor(config.jwtTtlMs / 1000)
