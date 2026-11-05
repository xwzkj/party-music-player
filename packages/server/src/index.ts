import { randomBytes } from 'node:crypto'
import { authService } from './auth/authService.ts'
import { config } from './config.ts'
import { openDb } from './db/connection.ts'
import { roomsRepo } from './db/rooms.ts'
import { SettingKey, settingsRepo } from './db/settings.ts'
import { buildApp } from './http/app.ts'
import { logger } from './infra/logger.ts'
import { attachRealtime } from './realtime/gateway.ts'
import { playbackService } from './services/playbackService.ts'
import { roomService } from './services/roomService.ts'
import { roomStore } from './services/roomStore.ts'

function jwtSecret(): string {
  if (config.jwtSecret) return config.jwtSecret
  let s = settingsRepo.get(SettingKey.jwtSecret)
  if (!s) {
    s = randomBytes(32).toString('hex')
    settingsRepo.set(SettingKey.jwtSecret, s)
  }
  return s
}

async function main(): Promise<void> {
  openDb(config.dbPath)
  await authService.ensureAdmin()
  roomStore.loadAll(Date.now())
  for (const room of roomStore.all()) playbackService.restore(room)

  const app = await buildApp(jwtSecret())
  const io = attachRealtime(app)

  const sweeper = setInterval(() => roomService.sweep(), config.rerankIntervalMs)
  sweeper.unref()

  await app.listen({ host: config.host, port: config.port })
  logger.info(`music provider: ${config.musicProvider}; rooms restored: ${roomStore.all().length}`)

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down')
    clearInterval(sweeper)
    for (const room of roomStore.all()) roomsRepo.setTimeline(room.id, room.timeline, room.upNextId)
    io.close()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((e) => {
  logger.fatal({ err: e }, 'failed to start')
  process.exit(1)
})
