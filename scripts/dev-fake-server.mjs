// 本地预览用：假音乐源 + 独立的数据库文件，不碰 data/app.db
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: path.join(root, 'packages/server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    MUSIC_PROVIDER: 'fake',
    DB_PATH: path.join(root, 'data', 'preview.db'),
    BCRYPT_COST: '4',
    PORT: '3000',
  },
})
child.on('exit', (code) => process.exit(code ?? 0))
