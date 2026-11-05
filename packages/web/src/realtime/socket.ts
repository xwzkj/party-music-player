import { io, type Socket } from 'socket.io-client'
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@pmp/shared'
import { ApiError, messageFor } from '../api/http'

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: AppSocket | null = null

/** 服务器时间 ≈ 本机时间 + offset */
let offset = 0
let samples: { rtt: number; offset: number }[] = []
let syncTimer: number | null = null

export const serverNow = (): number => Date.now() + offset
export const clockOffset = (): number => offset

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], autoConnect: false })
    socket.on('connect', () => {
      samples = []
      void syncClock(5)
    })
  }
  return socket
}

export function emit<T = unknown>(event: keyof ClientToServerEvents, payload: unknown, timeoutMs = 8000): Promise<T> {
  const s = getSocket()
  return new Promise((resolve, reject) => {
    ;(s.timeout(timeoutMs) as any).emit(event, payload, (err: Error | null, res: Ack<T>) => {
      if (err) return reject(new ApiError('TIMEOUT', 0, '请求超时'))
      if (res.ok) resolve(res.data)
      else reject(new ApiError(res.code, 400, messageFor(res.code, res.message)))
    })
  })
}

async function pingOnce(): Promise<void> {
  const t0 = Date.now()
  const r = await emit<{ t0: number; ts: number }>('time:ping', { t0 }, 3000)
  const t1 = Date.now()
  const rtt = t1 - r.t0
  samples.push({ rtt, offset: r.ts + rtt / 2 - t1 })
  if (samples.length > 10) samples.shift()
  // 取 rtt 最小的那次
  offset = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset
}

export async function syncClock(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    try {
      await pingOnce()
    } catch {
      return
    }
  }
}

export function startClockSync(): void {
  if (syncTimer !== null) return
  syncTimer = window.setInterval(() => {
    if (socket?.connected) void syncClock(1)
  }, 30_000)
}

export function stopClockSync(): void {
  if (syncTimer !== null) window.clearInterval(syncTimer)
  syncTimer = null
}
