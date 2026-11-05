import './setupEnv.ts'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioc, type Socket } from 'socket.io-client'
import type { Ack, ChatMessage, RoomSnapshot } from '@pmp/shared'
import { openDb } from '../src/db/connection.ts'
import { usersRepo } from '../src/db/users.ts'
import { buildApp } from '../src/http/app.ts'
import { attachRealtime } from '../src/realtime/gateway.ts'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let base = ''
const sockets: Socket[] = []

class Client {
  cookie = ''
  socket!: Socket
  last: RoomSnapshot | null = null
  chats: ChatMessage[] = []
  private waiters: { pred: (s: RoomSnapshot) => boolean; resolve: (s: RoomSnapshot) => void }[] = []

  async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: base,
        cookie: this.cookie,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    return { status: res.status, data: (await res.json()) as T }
  }

  connect(): Promise<void> {
    this.socket = ioc(base, {
      transports: ['websocket'],
      extraHeaders: { cookie: this.cookie, origin: base },
      reconnection: false,
    })
    sockets.push(this.socket)
    this.socket.on('room:state', (s: RoomSnapshot) => {
      if (this.last && s.version < this.last.version) return
      this.last = s
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(s)) {
          w.resolve(s)
          return false
        }
        return true
      })
    })
    this.socket.on('chat:message', (m: ChatMessage) => this.chats.push(m))
    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => resolve())
      this.socket.on('connect_error', reject)
    })
  }

  emit<T = unknown>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => this.socket.emit(event, payload, resolve))
  }

  waitFor(pred: (s: RoomSnapshot) => boolean, ms = 3000): Promise<RoomSnapshot> {
    if (this.last && pred(this.last)) return Promise.resolve(this.last)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for snapshot')), ms)
      this.waiters.push({
        pred,
        resolve: (s) => {
          clearTimeout(t)
          resolve(s)
        },
      })
    })
  }
}

beforeAll(async () => {
  openDb(':memory:')
  app = await buildApp('test-secret')
  attachRealtime(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
})

afterAll(async () => {
  for (const s of sockets) s.disconnect()
  await app.close()
})

describe('full flow', () => {
  const host = new Client()
  const a = new Client()
  const b = new Client()
  let code = ''
  let passcode = ''
  let firstSrc = ''
  let secondSrc = ''

  it('registers and logs in', async () => {
    for (const [c, name] of [
      [host, 'host_user'],
      [a, 'member_a'],
      [b, 'member_b'],
    ] as const) {
      const r = await c.req('POST', '/api/auth/register', { username: name, password: 'password123' })
      expect(r.status).toBe(200)
      expect(r.data.username).toBe(name)
      await c.req('PATCH', '/api/me', { nickname: name.toUpperCase() })
    }
    const bad = await a.req('POST', '/api/auth/login', { username: 'member_a', password: 'wrong-pass' })
    expect(bad.data.code).toBe('BAD_CREDENTIALS')
    const ok = await a.req('POST', '/api/auth/login', { username: 'member_a', password: 'password123' })
    expect(ok.status).toBe(200)
  })

  it('rejects requests without a matching Origin', async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'x', password: 'y' }),
    })
    expect(res.status).toBe(403)
  })

  it('needs permission to create a room', async () => {
    const r = await host.req('POST', '/api/rooms', {})
    expect(r.data.code).toBe('FORBIDDEN')
    const u = usersRepo.byUsername('host_user')!
    usersRepo.setCanCreateRoom(u.id, true)
    const ok = await host.req('POST', '/api/rooms', { passcode: 'abcd' })
    expect(ok.status).toBe(200)
    code = ok.data.code
    passcode = ok.data.passcode
    expect(code).toMatch(/^\d{6}$/)
    expect(passcode).toBe('abcd')
  })

  it('joins with passcode', async () => {
    const bad = await a.req('POST', `/api/rooms/${code}/join`, { passcode: 'nope' })
    expect(bad.data.code).toBe('BAD_PASSCODE')
    expect((await a.req('POST', `/api/rooms/${code}/join`, { passcode })).status).toBe(200)
    expect((await b.req('POST', `/api/rooms/${code}/join`, { passcode })).status).toBe(200)
  })

  it('enters via socket and receives snapshots', async () => {
    for (const c of [host, a, b]) {
      await c.connect()
      const r = await c.emit('room:enter', { code })
      expect(r.ok).toBe(true)
    }
    const s = await host.waitFor((s) => s.members.length === 3)
    expect(s.me.isHost).toBe(true)
    expect(s.host?.passcode).toBe(passcode)
    const sa = await a.waitFor((s) => s.members.length === 3)
    expect(sa.host).toBeUndefined()
  })

  it('host can change the passcode to a custom one', async () => {
    const tooShort = await host.emit('host:resetPasscode', { passcode: 'x' })
    expect(tooShort.ok).toBe(false)
    const r = await host.emit<{ passcode: string }>('host:resetPasscode', { passcode: 'xyz9' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.data.passcode).toBe('xyz9')
    const s = await host.waitFor((s) => s.host?.passcode === 'xyz9')
    expect(s.host?.passcode).toBe('xyz9')
    passcode = 'xyz9'
  })

  it('queues songs, merges duplicates, and ranks by votes', async () => {
    const r1 = await a.emit<{ itemId: string }>('queue:add', { sourceId: '100001' })
    const r2 = await b.emit<{ itemId: string }>('queue:add', { sourceId: '100002' })
    expect(r1.ok && r2.ok).toBe(true)
    const unavailable = await a.emit('queue:add', { sourceId: '100008' })
    expect(unavailable).toMatchObject({ ok: false, code: 'TRACK_UNAVAILABLE' })
    const trial = await a.emit('queue:add', { sourceId: '100009' })
    expect(trial).toMatchObject({ ok: false, code: 'TRACK_TRIAL_ONLY' })

    const s = await a.waitFor((s) => s.queue.length === 2)
    const mine = s.queue.find((q) => q.mine)!
    const own = await a.emit('vote:set', { itemId: mine.id, vote: 1 })
    expect(own).toMatchObject({ ok: false, code: 'CANNOT_VOTE_OWN' })

    // b 也点 100001：合并计数
    await b.emit('queue:add', { sourceId: '100001' })
    const merged = await a.waitFor((s) => s.queue.some((q) => q.addedBy.length === 2))
    const both = merged.queue.find((q) => q.track.sourceId === '100001')!
    expect(both.addedBy.map((x) => x.nickname).sort()).toEqual(['MEMBER_A', 'MEMBER_B'])
    // 排序只听服务端：总分高的在前
    expect(merged.queue[0].score.total).toBeGreaterThanOrEqual(merged.queue[1].score.total)
    firstSrc = merged.queue[0].track.sourceId
    secondSrc = merged.queue[1].track.sourceId
  })

  it('starts playing when a device listens', async () => {
    await host.emit('audio:listening', { on: true })
    const s = await host.waitFor((s) => s.timeline.state === 'playing')
    expect(s.nowPlaying?.item.track.sourceId).toBe(firstSrc)
    expect(s.queue.length).toBe(1)

    const url = await a.req('POST', `/api/rooms/${code}/play-url`, { itemId: s.nowPlaying!.item.id })
    expect(url.status).toBe(200)
    expect(url.data.url).toContain(`/api/dev/tone/${firstSrc}`)
    expect(url.data.via).toBe('host')
  })

  it('half mode with 3 present needs 2 votes to pause; reverse vote is cooled down', async () => {
    const s = await a.waitFor((s) => s.timeline.state === 'playing')
    const itemId = s.nowPlaying!.item.id
    expect(s.nowPlaying!.votes.pause.needed).toBe(2)
    const v1 = await a.emit<{ passed: boolean }>('play:vote', { kind: 'pause', itemId, on: true })
    expect(v1).toMatchObject({ ok: true, data: { passed: false } })
    await a.waitFor((s) => s.nowPlaying!.votes.pause.count === 1)
    const v2 = await b.emit<{ passed: boolean }>('play:vote', { kind: 'pause', itemId, on: true })
    expect(v2).toMatchObject({ ok: true, data: { passed: true } })
    const paused = await a.waitFor((s) => s.timeline.state === 'paused')
    expect(paused.timeline.pausedBy).toBe('vote')

    const early = await a.emit('play:vote', { kind: 'resume', itemId, on: true })
    expect(early).toMatchObject({ ok: false, code: 'VOTE_COOLDOWN' })
    await new Promise((r) => setTimeout(r, 350))
    await a.emit('play:vote', { kind: 'resume', itemId, on: true })
    await b.emit('play:vote', { kind: 'resume', itemId, on: true })
    await a.waitFor((s) => s.timeline.state === 'playing')
  })

  it('host pauses; members can vote to resume', async () => {
    expect((await host.emit('host:playback', { action: 'pause' })).ok).toBe(true)
    const s = await a.waitFor((s) => s.timeline.state === 'paused' && s.timeline.pausedBy === 'host')
    expect(s.nowPlaying!.votes.resume.open).toBe(true)
    const memberDirect = await a.emit('host:playback', { action: 'resume' })
    expect(memberDirect).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    await new Promise((r) => setTimeout(r, 350))
    const itemId = s.nowPlaying!.item.id
    await a.emit('play:vote', { kind: 'resume', itemId, on: true })
    await b.emit('play:vote', { kind: 'resume', itemId, on: true })
    await a.waitFor((s) => s.timeline.state === 'playing')
  })

  it('vote skip then vote prev', async () => {
    const s = await a.waitFor((s) => s.timeline.state === 'playing')
    const first = s.nowPlaying!.item
    await a.emit('play:vote', { kind: 'skip', itemId: first.id, on: true })
    await b.emit('play:vote', { kind: 'skip', itemId: first.id, on: true })
    const s2 = await a.waitFor((x) => x.nowPlaying?.item.id !== first.id && x.timeline.state === 'playing')
    expect(s2.nowPlaying!.item.track.sourceId).toBe(secondSrc)
    expect(s2.hasHistory).toBe(true)

    // 过期的 itemId 被忽略
    const stale = await a.emit<{ passed: boolean }>('play:vote', { kind: 'skip', itemId: first.id, on: true })
    expect(stale).toMatchObject({ ok: true, data: { passed: false } })

    const second = s2.nowPlaying!.item
    await a.emit('play:vote', { kind: 'prev', itemId: second.id, on: true })
    await b.emit('play:vote', { kind: 'prev', itemId: second.id, on: true })
    const s3 = await a.waitFor((x) => x.nowPlaying?.item.track.sourceId === firstSrc)
    expect(s3.upNext?.track.sourceId).toBe(secondSrc)
  })

  it('advances automatically when the timeline ends', async () => {
    const s = await host.waitFor((s) => s.timeline.state === 'playing')
    const dur = s.timeline.durationMs
    await host.emit('host:playback', { action: 'seek', positionMs: dur - 300 })
    const next = await host.waitFor((x) => x.nowPlaying?.item.track.sourceId === secondSrc, 4000)
    expect(next.timeline.state).toBe('playing')
  })

  it('chat and system messages', async () => {
    const r = await a.emit<ChatMessage>('chat:send', { content: '  hello\u0007 ' })
    expect(r).toMatchObject({ ok: true, data: { content: 'hello' } })
    const hist = await a.req<ChatMessage[]>('GET', `/api/rooms/${code}/chat`)
    expect(hist.data.some((m) => m.kind === 'system' && m.systemType === 'nowPlaying')).toBe(true)
    expect(hist.data.some((m) => m.kind === 'system' && m.systemType === 'join')).toBe(true)
    expect(hist.data.at(-1)?.content).toBe('hello')
  })

  it('host kicks with ban', async () => {
    const bId = usersRepo.byUsername('member_b')!.id
    expect((await host.emit('host:kick', { userId: bId, ban: true })).ok).toBe(true)
    const s = await host.waitFor((s) => s.members.length === 2)
    expect(s.host?.bans.map((x) => x.id)).toContain(bId)
    const again = await b.req('POST', `/api/rooms/${code}/join`, { passcode })
    expect(again.data.code).toBe('BANNED')
  })

  it('host closes the room', async () => {
    const closed = new Promise((r) => a.socket.once('room:closed', r))
    expect((await host.emit('host:close', {})).ok).toBe(true)
    await closed
    const info = await a.req('GET', `/api/rooms/${code}`)
    expect(info.data.open).toBe(false)
  })
})
