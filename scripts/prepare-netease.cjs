/**
 * 网易云接口库的运行时准备脚本（部署用）。
 *
 * 该库在 import 时会同步读取 $TMPDIR/anonymous_token，并在请求播放地址时
 * 读取 $TMPDIR/xeapi_public_key；两个文件缺失时搜索能用、播放地址会报错。
 * systemd 单元把 TMPDIR 指到 data/tmp，保证重启后仍有缓存；这里只补齐缺失文件。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  const tmpDir = os.tmpdir()
  const keyPath = path.join(tmpDir, 'xeapi_public_key')
  const tokenPath = path.join(tmpDir, 'anonymous_token')

  fs.mkdirSync(tmpDir, { recursive: true })
  // 接口库 import 时同步读取，缺失会让服务端模块加载失败
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', { mode: 0o600 })

  if (fs.existsSync(keyPath)) return

  try {
    const generateConfig = require('@neteasecloudmusicapienhanced/api/generateConfig.js')
    await generateConfig()
  } catch (err) {
    console.warn('[prepare-netease] 生成网易云公钥失败：', err instanceof Error ? err.message : err)
  }

  if (!fs.existsSync(keyPath)) {
    console.warn('[prepare-netease] 仍缺少 xeapi_public_key，播放地址可能不可用')
  }
}

main().catch((err) => {
  console.warn('[prepare-netease] 准备失败：', err instanceof Error ? err.message : err)
})
