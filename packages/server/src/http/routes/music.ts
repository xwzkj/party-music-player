import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError, resolvePlaylistSchema, searchQuerySchema } from '@pmp/shared'
import { config } from '../../config.ts'
import { limiter } from '../../infra/rateLimit.ts'
import { fetchCover } from '../../music/cover.ts'
import { fakeTrackDuration, toneWav } from '../../music/fakeProvider.ts'
import { music, parsePlaylistLink } from '../../music/index.ts'
import { neteaseService } from '../../services/neteaseService.ts'
import { parse, requireUser } from '../helpers.ts'

const searchPerUser = limiter(20, 60_000)

export async function musicRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireUser)

  app.get('/api/music/search', async (req) => {
    const q = parse(searchQuerySchema, req.query)
    if (!searchPerUser.take(req.me.id)) throw new AppError('RATE_LIMITED', 429)
    if (q.type === 'track') return music.searchTracks(q.q, q.page)
    if (q.type === 'artist') return music.searchArtists(q.q, q.page)
    return music.searchPlaylists(q.q, q.page)
  })

  app.post('/api/music/playlist/resolve', async (req) => {
    const b = parse(resolvePlaylistSchema, req.body)
    const id = parsePlaylistLink(b.link)
    if (!id) throw new AppError('VALIDATION_FAILED', 400, '无法识别的歌单链接')
    return { id }
  })

  app.get('/api/music/playlists/:id/tracks', async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^\d{1,20}$/) }), req.params)
    const q = parse(z.object({ page: z.coerce.number().int().min(1).max(100).default(1) }), req.query)
    return music.getPlaylistTracks(id, q.page, neteaseService.cookieOf(req.me.id))
  })

  app.get('/api/music/artists/:id/tracks', async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^\d{1,20}$/) }), req.params)
    return music.getArtistTopTracks(id)
  })

  app.get('/api/music/lyrics/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^\d{1,20}$/) }), req.params)
    return music.getLyrics(id)
  })

  app.get('/api/music/cover', async (req, reply) => {
    const q = parse(z.object({ url: z.string().max(500) }), req.query)
    const img = await fetchCover(q.url)
    reply.header('content-type', img.type).header('cache-control', 'private, max-age=3600')
    return reply.send(img.body)
  })

  if (config.musicProvider === 'fake') {
    app.get('/api/dev/tone/:id', async (req, reply) => {
      const { id } = parse(z.object({ id: z.string().regex(/^\d{1,20}\.wav$/) }), req.params)
      const sid = id.slice(0, -4)
      reply.header('content-type', 'audio/wav').header('cache-control', 'private, max-age=3600')
      return reply.send(toneWav(sid, fakeTrackDuration(sid)))
    })
  }
}
