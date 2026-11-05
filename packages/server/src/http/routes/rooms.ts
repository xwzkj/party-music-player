import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createRoomSchema, joinRoomSchema, playUrlSchema, roomCodeSchema } from '@pmp/shared'
import { chatService } from '../../services/chatService.ts'
import { getPlayUrl } from '../../services/playUrlService.ts'
import { roomService } from '../../services/roomService.ts'
import { parse, requireUser } from '../helpers.ts'

const codeParam = z.object({ code: roomCodeSchema })

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser)

  app.get('/api/rooms', async (req) => roomService.myRooms(req.me))

  app.post('/api/rooms', async (req) => {
    const b = parse(createRoomSchema, req.body)
    const room = roomService.create(req.me, b.passcode)
    return { code: room.code, passcode: room.passcode }
  })

  app.get('/api/rooms/:code', async (req) => roomService.info(parse(codeParam, req.params).code, req.me))

  app.post('/api/rooms/:code/join', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { code } = parse(codeParam, req.params)
    const b = parse(joinRoomSchema, req.body)
    roomService.join(code, req.me, b.passcode)
    return { ok: true }
  })

  app.get('/api/rooms/:code/chat', async (req) => {
    const { code } = parse(codeParam, req.params)
    const q = parse(z.object({ before: z.coerce.number().int().positive().optional() }), req.query)
    const room = roomService.requireOpen(code)
    roomService.requireMember(room, req.me.id)
    return chatService.history(room, q.before)
  })

  app.post('/api/rooms/:code/play-url', async (req) => {
    const { code } = parse(codeParam, req.params)
    const b = parse(playUrlSchema, req.body)
    const room = roomService.requireOpen(code)
    return getPlayUrl(room, req.me.id, b.itemId)
  })
}
