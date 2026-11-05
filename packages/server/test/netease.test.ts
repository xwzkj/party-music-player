import './setupEnv.ts'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { NeteaseBinding } from '@pmp/shared'
import { openDb } from '../src/db/connection.ts'
import { buildApp } from '../src/http/app.ts'

let app: FastifyInstance
let base = ''
let cookie = ''

async function req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: base,
      cookie,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, data: (await res.json()) as T }
}

beforeAll(async () => {
  openDb(':memory:')
  app = await buildApp('test-secret')
  await app.listen({ host: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  const r = await req('POST', '/api/auth/register', { username: 'phonebinder', password: 'password123' })
  expect(r.status).toBe(200)
})

afterAll(async () => {
  await app.close()
})

describe('网易云绑定', () => {
  it('obtains a login token and stores the account', async () => {
    const sent = await req('POST', '/api/netease/login/captcha', { phone: '13800138000' })
    expect(sent.status).toBe(200)

    const bound = await req<NeteaseBinding>('POST', '/api/netease/login/phone', {
      phone: '13800138000',
      captcha: '1234',
    })
    expect(bound.status).toBe(200)
    expect(bound.data).toMatchObject({ bound: true, vip: true })

    const me = await req<NeteaseBinding>('GET', '/api/netease/me')
    expect(me.status).toBe(200)
    expect(me.data).toMatchObject({ bound: true })
  })

  it('rejects a wrong captcha', async () => {
    const r = await req('POST', '/api/netease/login/phone', { phone: '13800138000', captcha: '0000' })
    expect(r.status).toBe(400)
    expect(r.data).toMatchObject({ code: 'NETEASE_ERROR' })
  })

  it('validates the phone number', async () => {
    const r = await req('POST', '/api/netease/login/phone', { phone: '123', captcha: '1234' })
    expect(r.status).toBe(400)
    expect(r.data).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rate limits captcha sending', async () => {
    // 上面已经发过 1 次，窗口内上限 3 次
    await req('POST', '/api/netease/login/captcha', { phone: '13800138001' })
    await req('POST', '/api/netease/login/captcha', { phone: '13800138002' })
    const r = await req('POST', '/api/netease/login/captcha', { phone: '13800138003' })
    expect(r.status).toBe(429)
    expect(r.data).toMatchObject({ code: 'RATE_LIMITED' })
  })
})
