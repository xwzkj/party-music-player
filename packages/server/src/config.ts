import path from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../..')

function num(name: string, def: number): number {
  const v = env[name]
  if (v === undefined || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

function bool(name: string, def: boolean): boolean {
  const v = env[name]
  if (v === undefined || v === '') return def
  return v === '1' || v.toLowerCase() === 'true'
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: num('PORT', 3000),
  dbPath: env.DB_PATH ?? path.join(repoRoot, 'data', 'app.db'),
  webDist: env.WEB_DIST ?? path.join(repoRoot, 'packages', 'web', 'dist'),
  jwtSecret: env.JWT_SECRET ?? null,
  cookieSecure: bool('COOKIE_SECURE', false),
  /** 额外允许的 Origin（逗号分隔），默认只允许与 Host 同源 */
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: bool('TRUST_PROXY', false),
  logLevel: env.LOG_LEVEL ?? 'info',
  /** 设为 fake 时使用假的音乐源（开发与测试用） */
  musicProvider: (env.MUSIC_PROVIDER ?? 'netease') as 'netease' | 'fake',

  smtp: {
    host: env.SMTP_HOST ?? '',
    port: num('SMTP_PORT', 465),
    secure: bool('SMTP_SECURE', true),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? env.SMTP_USER ?? '',
  },
  turnstile: {
    siteKey: env.TURNSTILE_SITE_KEY ?? '',
    secretKey: env.TURNSTILE_SECRET_KEY ?? '',
  },

  jwtTtlMs: 7 * 24 * HOUR,
  bcryptCost: num('BCRYPT_COST', 12),

  presenceGraceMs: num('PRESENCE_GRACE_MS', 10 * MIN),
  orderCapMs: num('ORDER_CAP_MS', 60 * MIN),
  durationBestMs: 2 * MIN,
  durationWorstMs: 7 * MIN,
  lockAheadMs: num('LOCK_AHEAD_MS', 15 * SEC),
  bufferPreloadedMs: 800,
  bufferColdMs: 2000,
  noListenerPauseMs: num('NO_LISTENER_PAUSE_MS', 10 * SEC),
  anyoneCooldownMs: 30 * SEC,
  reverseVoteCooldownMs: num('REVERSE_VOTE_COOLDOWN_MS', 10 * SEC),
  broadcastThrottleMs: 150,
  rerankIntervalMs: 60 * SEC,
  joinLeaveDedupeMs: 60 * SEC,
  roomIdleCloseMs: num('ROOM_IDLE_CLOSE_MS', 2 * HOUR),
  roomMaxAgeMs: num('ROOM_MAX_AGE_MS', 24 * HOUR),
  maxMembers: 30,
  maxQueue: 200,
  maxConsecutiveErrors: 3,
  fallbackAvoidRecent: 20,
  playabilityCacheMs: 10 * MIN,
} as const

export type Config = typeof config

export const defaultWeights = { vote: 4, adds: 2.6, order: 2.6, popularity: 2.4, duration: 1 }
