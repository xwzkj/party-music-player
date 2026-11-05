import { LRUCache } from 'lru-cache'
import { AppError } from '@pmp/shared'

/** 只代理网易云图片域名的 HTTPS 地址，防止 SSRF */
const HOST_RE = /^p\d{1,2}\.music\.126\.net$/
const MAX_BYTES = 512 * 1024

const cache = new LRUCache<string, { type: string; body: Buffer }>({
  maxSize: 32 * 1024 * 1024,
  sizeCalculation: (v) => v.body.length || 1,
  ttl: 60 * 60_000,
})

export function validateCoverUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new AppError('VALIDATION_FAILED')
  }
  if (u.protocol !== 'https:' || !HOST_RE.test(u.hostname) || u.port || u.username || u.password) {
    throw new AppError('VALIDATION_FAILED')
  }
  // 只取小尺寸缩略图
  u.search = '?param=120y120'
  return u
}

export async function fetchCover(raw: string): Promise<{ type: string; body: Buffer }> {
  const u = validateCoverUrl(raw)
  const key = u.toString()
  const hit = cache.get(key)
  if (hit) return hit
  const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (res.status !== 200) throw new AppError('NETEASE_ERROR', 502)
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new AppError('NETEASE_ERROR', 502)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) throw new AppError('NETEASE_ERROR', 502)
  const ab = await res.arrayBuffer()
  if (ab.byteLength > MAX_BYTES) throw new AppError('NETEASE_ERROR', 502)
  const v = { type, body: Buffer.from(ab) }
  cache.set(key, v)
  return v
}
