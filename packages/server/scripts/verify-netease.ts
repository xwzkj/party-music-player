/**
 * M0 验证脚本：确认当前版本的网易云接口库可用。
 * 用法：npm run verify:netease -w @pmp/server
 * 可选环境变量 NETEASE_COOKIE：用一个已登录的 Cookie 测试会员歌曲和用户歌单。
 */
import { NeteaseClient } from '../src/music/neteaseClient.ts'
import { validateCoverUrl } from '../src/music/cover.ts'

const client = new NeteaseClient()
const cookie = process.env.NETEASE_COOKIE || undefined
let failed = 0

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`✔ ${name}: ${await fn()}`)
  } catch (e) {
    failed++
    console.log(`✘ ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

let sampleId = ''
let coverUrl = ''

await check('搜索歌曲 cloudsearch type=1', async () => {
  const r = await client.searchTracks('周杰伦 晴天', 1)
  if (!r.length) throw new Error('没有结果')
  sampleId = r[0].sourceId
  coverUrl = r[0].coverUrl
  return `${r.length} 首，第一首 ${r[0].title}（id ${sampleId}）`
})

await check('搜索歌单 cloudsearch type=1000', async () => {
  const r = await client.searchPlaylists('聚会', 1)
  if (!r.length) throw new Error('没有结果')
  return `${r.length} 个，第一个 ${r[0].name}`
})

await check('歌曲详情 song_detail（含 pop）', async () => {
  const [t] = await client.getTracks([sampleId])
  if (!t) throw new Error('没有返回歌曲')
  return `时长 ${t.durationMs} ms，pop=${t.popularity}`
})

await check('播放地址 song_url_v1（匿名）', async () => {
  const r = await client.getPlayUrl(sampleId, 'standard')
  return r.url ? `${r.trialOnly ? '只有试听' : '完整'}，过期 ${new Date(r.expiresAt).toLocaleTimeString()}` : '拿不到地址'
})

if (cookie) {
  await check('播放地址 song_url_v1（带 Cookie）', async () => {
    const r = await client.getPlayUrl(sampleId, 'exhigh', cookie)
    return r.url ? (r.trialOnly ? '只有试听' : '完整') : '拿不到地址'
  })
  await check('账号信息 user_account', async () => {
    const a = await client.getAccount(cookie)
    return `${a.nickname}（vipType ${a.vipType}）`
  })
}

await check('歌词 lyric_new（确认 lrc / yrc / tlyric 字段）', async () => {
  const r = await client.getLyrics(sampleId)
  return `lrc=${!!r.lrc} yrc=${!!r.yrc} tlyric=${!!r.tlyric}`
})

await check('扫码登录 login_qr_key + login_qr_create', async () => {
  const q = await client.createLoginQr()
  const s = await client.checkLoginQr(q.key)
  return `key 长度 ${q.key.length}，二维码图片 ${q.qrImage.startsWith('data:image') ? '正常' : '缺失'}，状态 ${s.status}`
})

await check('封面 CORS（决定是否需要 /api/music/cover 代理）', async () => {
  if (!coverUrl) throw new Error('没有封面地址')
  validateCoverUrl(coverUrl)
  const res = await fetch(`${coverUrl}?param=120y120`, { headers: { origin: 'https://example.com' } })
  const acao = res.headers.get('access-control-allow-origin')
  return acao ? `CDN 返回 ACAO=${acao}，可以直接取色` : '没有 CORS 头，需要走代理（前端已默认使用代理）'
})

console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
