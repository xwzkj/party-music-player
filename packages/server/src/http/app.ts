import fs from 'node:fs'
import path from 'node:path'
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { AppError, errorMessages } from '@pmp/shared'
import { config } from '../config.ts'
import { logger } from '../infra/logger.ts'
import { COOKIE_NAME } from './helpers.ts'
import { originAllowed } from './origin.ts'
import { adminRoutes } from './routes/admin.ts'
import { authRoutes } from './routes/auth.ts'
import { meRoutes } from './routes/me.ts'
import { musicRoutes } from './routes/music.ts'
import { roomRoutes } from './routes/rooms.ts'

const NETEASE_MEDIA = ['https://*.music.126.net', 'http://*.music.126.net', 'https://*.126.net', 'http://*.126.net']

export async function buildApp(jwtSecret: string): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    logController: new LogController({ disableRequestLogging: config.logLevel !== 'debug' }),
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', ...NETEASE_MEDIA],
        mediaSrc: ["'self'", 'blob:', 'data:', ...NETEASE_MEDIA],
        connectSrc: ["'self'"],
        frameSrc: ['https://challenges.cloudflare.com'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: config.cookieSecure,
    crossOriginEmbedderPolicy: false,
    // 网易云 CDN 不发 CORP 头
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
  await app.register(cookie)
  await app.register(jwt, { secret: jwtSecret, cookie: { cookieName: COOKIE_NAME, signed: false } })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ code: 'RATE_LIMITED', message: errorMessages.RATE_LIMITED, statusCode: 429 }),
  })

  // 修改类请求检查 Origin（防 CSRF）
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
    if (!req.url.startsWith('/api/')) return
    if (!originAllowed(req.headers.origin, req.headers.host, req.headers['sec-fetch-site'])) {
      throw new AppError('FORBIDDEN', 403, 'Origin 不被允许')
    }
  })

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message })
    }
    if (err?.statusCode === 429) {
      return reply.status(429).send({ code: 'RATE_LIMITED', message: errorMessages.RATE_LIMITED })
    }
    if (err?.validation || err?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err?.statusCode === 400) {
      return reply.status(400).send({ code: 'VALIDATION_FAILED', message: errorMessages.VALIDATION_FAILED })
    }
    if (err?.statusCode === 413) {
      return reply.status(413).send({ code: 'VALIDATION_FAILED', message: '请求体太大' })
    }
    req.log.error({ err }, 'unhandled error')
    return reply.status(500).send({ code: 'INTERNAL', message: errorMessages.INTERNAL })
  })

  await app.register(authRoutes)
  await app.register(meRoutes)
  await app.register(adminRoutes)
  await app.register(roomRoutes)
  await app.register(musicRoutes)

  app.get('/api/health', async () => ({ ok: true }))

  // 生产环境托管前端构建产物：静态文件、/api、/socket.io 都在同一个端口上
  const hasWeb = fs.existsSync(config.webDist)
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
      // vite 产出的文件名带内容哈希，可以放心长缓存；index.html 反过来，部署完要立刻生效
      setHeaders(reply, filePath) {
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`)
        reply.header('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/socket.io') && hasWeb) {
      return reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html')
    }
    return reply.status(404).send({ code: 'NOT_FOUND', message: errorMessages.NOT_FOUND })
  })

  return app
}
