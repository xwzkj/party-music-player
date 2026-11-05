# 聚会音乐播放器

大家一起点歌、投票，播放顺序按投票、点歌人次、等待时间、热门度和时长加权排序。实现依据 `文档/架构设计/综合/架构.md`。

## 环境

- Node.js 24 或更高（需要原生运行 `.ts` 和 `node:sqlite`；设计目标是 Node 26 LTS）
- 服务器要能访问网易云；放在国内，否则很多歌拿不到播放地址

## 开发

```bash
npm install
cp .env.example .env
npm run dev:server   # 后端 http://localhost:3000
npm run dev:web      # 前端 http://localhost:5173（代理 /api 和 /socket.io 到后端）
```

首次启动时，后端会在日志里打印管理员账号 `admin` 的随机密码，只显示一次。管理员首次登录必须修改密码。

不想访问网易云时，在 `.env` 里设 `MUSIC_PROVIDER=fake`：搜索返回假歌曲，播放的是服务端生成的正弦波。id 以 8 结尾的歌无法播放，以 9 结尾的只能试听。

## 测试与检查

```bash
npm test                                  # Vitest：排序、投票、时间轴、歌词，以及完整流程的集成测试
npm run typecheck                         # tsc --noEmit 与 vue-tsc
npm run verify:netease -w @pmp/server     # M0：验证网易云接口在当前版本下可用
```

## 部署

```bash
npm install
npm run build        # 构建前端到 packages/web/dist
npm start            # 后端同时托管前端，同源部署
```

- **云服务器：** 用 Caddy 反向代理并自动签发证书，`.env` 里设 `COOKIE_SECURE=true`、`TRUST_PROXY=true`。
- **局域网：** 在房主电脑上运行，成员用 `http://<电脑局域网 IP>:3000` 访问。密码和登录 Cookie 在局域网内明文传输，只在可信的网络里使用。

数据库文件 `data/app.db` 里有明文的网易云 Cookie（小组决定），备份要按敏感数据保管。

## 目录

```text
packages/shared   前后端共用的类型、事件、zod 校验、错误码、歌词解析
packages/server   Fastify + Socket.IO + node:sqlite
  src/domain      纯函数：排序、投票、时间轴、在场
  src/services    房间、播放、聊天、网易云绑定、快照
  src/realtime    Socket.IO 网关与广播
  src/http        REST 路由
  src/music       网易云适配层、假音乐源、封面代理
packages/web      Vue 3 + Vite + Pinia + mdui 2
```
