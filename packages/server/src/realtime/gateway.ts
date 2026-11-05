import type { FastifyInstance } from 'fastify'
import { Server, type Socket } from 'socket.io'
import {
  AppError,
  socketSchemas,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pmp/shared'
import { authService } from '../auth/authService.ts'
import { config } from '../config.ts'
import type { UserRow } from '../db/users.ts'
import type { RoomRuntime } from '../domain/room.ts'
import { originAllowed } from '../http/origin.ts'
import { logger } from '../infra/logger.ts'
import { SlidingWindowLimiter } from '../infra/rateLimit.ts'
import { setBus, type RoomBus } from '../services/bus.ts'
import { chatService } from '../services/chatService.ts'
import { onAudioError, onListenersChanged, playbackService } from '../services/playbackService.ts'
import { isRoomHost, roomService } from '../services/roomService.ts'
import { roomStore } from '../services/roomStore.ts'
import { buildSnapshot, computeShared } from '../services/snapshot.ts'

interface SocketData {
  userId: string
  tv: number
  roomId: string | null
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

const channel = (roomId: string): string => `room:${roomId}`
const userChannel = (userId: string): string => `user:${userId}`

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

export function attachRealtime(app: FastifyInstance): IO {
  const io: IO = new Server(app.server, {
    path: '/socket.io',
    serveClient: false,
    allowRequest: (req, cb) => {
      cb(null, originAllowed(req.headers.origin, req.headers.host, req.headers['sec-fetch-site']))
    },
  })

  const timers = new Map<string, NodeJS.Timeout>()

  function socketsOf(room: RoomRuntime): S[] {
    const ids = io.sockets.adapter.rooms.get(channel(room.id))
    if (!ids) return []
    const out: S[] = []
    for (const id of ids) {
      const s = io.sockets.sockets.get(id)
      if (s) out.push(s)
    }
    return out
  }

  function flush(room: RoomRuntime): void {
    timers.delete(room.id)
    if (!roomStore.get(room.id)) return
    const shared = computeShared(room)
    for (const s of socketsOf(room)) {
      s.emit('room:state', buildSnapshot(room, shared, s.data.userId, s.id))
    }
  }

  const bus: RoomBus = {
    scheduleBroadcast(room) {
      if (timers.has(room.id)) return
      timers.set(room.id, setTimeout(() => flush(room), config.broadcastThrottleMs))
    },
    notice(room, target, level, text) {
      for (const s of socketsOf(room)) {
        const m = room.members.get(s.data.userId)
        const hit = target === 'all' || (target === 'hosts' ? !!m?.isHost : target.includes(s.data.userId))
        if (hit) s.emit('room:notice', { level, text })
      }
    },
    chat(room, msg) {
      io.to(channel(room.id)).emit('chat:message', msg)
    },
    chatDeleted(room, messageId) {
      io.to(channel(room.id)).emit('chat:deleted', { messageId })
    },
    closed(room) {
      const t = timers.get(room.id)
      if (t) clearTimeout(t)
      timers.delete(room.id)
      io.to(channel(room.id)).emit('room:closed', { code: room.code })
      io.in(channel(room.id)).socketsLeave(channel(room.id))
    },
    kicked(room, userId, banned) {
      for (const s of socketsOf(room)) {
        if (s.data.userId !== userId) continue
        s.emit('member:kicked', { code: room.code, banned })
        s.leave(channel(room.id))
        s.data.roomId = null
      }
    },
    toHosts(room, event, ...args) {
      for (const s of socketsOf(room)) {
        if (room.members.get(s.data.userId)?.isHost) s.emit(event, ...args)
      }
    },
  }
  setBus(bus)

  io.use((socket, next) => {
    try {
      const token = parseCookie(socket.request.headers.cookie, 'token')
      if (!token) return next(new Error('UNAUTHORIZED'))
      const payload = app.jwt.verify<{ uid: string; tv: number }>(token)
      const user = authService.userFromToken(payload.uid, payload.tv)
      if (!user) return next(new Error('UNAUTHORIZED'))
      socket.data.userId = user.id
      socket.data.tv = user.token_version
      socket.data.roomId = null
      socket.join(userChannel(user.id))
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket: S) => {
    const eventLimiter = new SlidingWindowLimiter(20, 1000)

    function currentRoom(): RoomRuntime {
      const id = socket.data.roomId
      const room = id ? roomStore.get(id) : undefined
      if (!room) throw new AppError('ROOM_NOT_FOUND', 404)
      return room
    }

    function currentUser(): UserRow {
      // 每次事件都重新读用户，确保被删除或改密码后立即失效
      const u = authService.userFromToken(socket.data.userId, socket.data.tv)
      if (!u) {
        socket.disconnect(true)
        throw new AppError('UNAUTHORIZED', 401)
      }
      return u
    }

    function requireHost(room: RoomRuntime, user: UserRow): void {
      if (!isRoomHost(room, user)) throw new AppError('FORBIDDEN', 403)
      if (!room.members.get(user.id)) throw new AppError('FORBIDDEN', 403)
    }

    function on<E extends keyof typeof socketSchemas>(
      event: E,
      handler: (payload: any, user: UserRow) => unknown | Promise<unknown>,
    ): void {
      socket.on(event as keyof ClientToServerEvents, async (raw: unknown, cb?: (r: Ack) => void) => {
        const ack = typeof cb === 'function' ? cb : () => {}
        if (!eventLimiter.take('e')) return ack({ ok: false, code: 'RATE_LIMITED' })
        const parsed = socketSchemas[event].safeParse(raw ?? {})
        if (!parsed.success) return ack({ ok: false, code: 'VALIDATION_FAILED' })
        try {
          const user = currentUser()
          const data = await handler(parsed.data, user)
          ack({ ok: true, data: data ?? null })
        } catch (e) {
          if (e instanceof AppError) return ack({ ok: false, code: e.code, message: e.message })
          logger.error({ err: e, event }, 'socket handler failed')
          ack({ ok: false, code: 'INTERNAL' })
        }
      })
    }

    function detach(): void {
      const id = socket.data.roomId
      if (!id) return
      socket.data.roomId = null
      socket.leave(channel(id))
      const room = roomStore.get(id)
      if (!room) return
      const wasListening = room.listeners.get(socket.id)?.listening
      room.listeners.delete(socket.id)
      const stillConnected = [...room.listeners.values()].some((l) => l.userId === socket.data.userId)
      if (!stillConnected) roomService.setOnline(room, socket.data.userId, false)
      if (wasListening) onListenersChanged(room)
    }

    on('time:ping', (p: { t0: number }) => ({ t0: p.t0, ts: Date.now() }))

    on('room:enter', (p: { code: string }, user) => {
      const room = roomStore.byCode(p.code)
      if (!room) throw new AppError('ROOM_NOT_FOUND', 404)
      if (room.bans.has(user.id)) throw new AppError('BANNED', 403)
      const m = room.members.get(user.id)
      if (!m) throw new AppError('FORBIDDEN', 403)
      if (socket.data.roomId && socket.data.roomId !== room.id) detach()
      if (m.left) roomService.rejoin(room, user)
      socket.data.roomId = room.id
      socket.join(channel(room.id))
      if (!room.listeners.has(socket.id)) {
        room.listeners.set(socket.id, { userId: user.id, listening: false, errorItemId: null })
      }
      roomService.setOnline(room, user.id, true)
      socket.emit('room:state', buildSnapshot(room, computeShared(room), user.id, socket.id))
      return { version: room.version }
    })

    on('room:leave', (p: { code: string }, user) => {
      const room = currentRoom()
      if (room.code !== p.code) return
      detach()
      roomService.leave(room, user.id)
    })

    on('audio:listening', (p: { on: boolean }) => {
      const room = currentRoom()
      const l = room.listeners.get(socket.id)
      if (!l) throw new AppError('FORBIDDEN', 403)
      if (l.listening === p.on) return
      l.listening = p.on
      if (!p.on) l.errorItemId = null
      onListenersChanged(room)
    })

    on('audio:error', (p: { itemId: string }) => {
      onAudioError(currentRoom(), socket.id, p.itemId)
    })

    on('queue:add', async (p: { sourceId: string }, user) => {
      const itemId = await roomService.addToQueue(currentRoom(), user, p.sourceId)
      return { itemId }
    })

    on('queue:withdraw', (p: { itemId: string }, user) => roomService.withdraw(currentRoom(), user.id, p.itemId))

    on('vote:set', (p: { itemId: string; vote: 1 | -1 | 0 }, user) =>
      roomService.setVote(currentRoom(), user.id, p.itemId, p.vote),
    )

    on('play:vote', (p: { kind: 'skip' | 'prev' | 'pause' | 'resume'; itemId: string; on: boolean }, user) =>
      playbackService.vote(currentRoom(), user.id, p.kind, p.itemId, p.on),
    )

    on('chat:send', (p: { content: string }, user) => chatService.send(currentRoom(), user.id, p.content))

    on('host:playback', (p: { action: 'pause' | 'resume' | 'next' | 'prev' | 'seek'; positionMs?: number }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      playbackService.host(room, p.action, p.positionMs)
    })

    on('host:queue', (p: { action: 'remove' | 'pin' | 'unpin' | 'setNext'; itemId: string }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      roomService.hostQueue(room, p.action, p.itemId)
    })

    on('host:settings', (p, user) => {
      const room = currentRoom()
      requireHost(room, user)
      roomService.updateSettings(room, p)
    })

    on('host:kick', (p: { userId: string; ban: boolean }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      roomService.kick(room, user, p.userId, p.ban)
    })

    on('host:unban', (p: { userId: string }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      roomService.unban(room, p.userId)
    })

    on('host:chatDelete', (p: { messageId: string }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      chatService.delete(room, p.messageId)
    })

    on('host:resetPasscode', (p: { passcode?: string }, user) => {
      const room = currentRoom()
      requireHost(room, user)
      return { passcode: roomService.resetPasscode(room, p.passcode) }
    })

    on('host:close', (_p, user) => {
      const room = currentRoom()
      requireHost(room, user)
      roomService.close(room, 'host')
    })

    socket.on('disconnect', () => detach())
  })

  return io
}
