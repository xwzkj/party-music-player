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

部署形态是**单端口**：`npm start` 之后，页面、`/api`、`/socket.io` 全在同一个端口（默认 3000，可用 `.env` 里的 `PORT` 改）上，不需要单独的静态服务器，也没有跨域。开发时分成 5173 + 3000 只是为了热更新，`npm run dev:web` 会把 `/api` 和 `/socket.io` 代理到后端。

`npm run build` 之后不用重启进程，刷新就能拿到新版本（构建产物要在启动时已存在，否则后端退化成只有 API）。

- **云服务器：** 前面放 Caddy 或 nginx 反向代理并签发证书，`.env` 里设 `COOKIE_SECURE=true`、`TRUST_PROXY=true`。
- **局域网：** 在房主电脑上运行，成员用 `http://<电脑局域网 IP>:3000` 访问。密码和登录 Cookie 在局域网内明文传输，只在可信的网络里使用。

nginx 反向代理示例（`map` 放在 `http {}` 里，`listen` 换成你的端口，全部转给 3000）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 8443 ssl http2;                             # 不用 80/443 也没问题，端口随便挑
    server_name party.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;        # /socket.io 走 WebSocket
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
```

关于防 CSRF 的同源校验（`src/http/origin.ts`）：浏览器声明 `Sec-Fetch-Site: same-origin` 的请求直接放行，没有这个头时只比较 Origin 和 Host 的**主机名**，端口和协议不参与比较——所以反代用自己的端口、把 Host 写成 `$host`（不带端口）都不会被拦。只有反代把 Host 改写成了别的域名（比如 `proxy_set_header Host $proxy_host`，后端看到的是 `127.0.0.1:3000`）时，才需要在 `.env` 里加 `ALLOWED_ORIGINS=https://party.example.com`。跨站页面发来的请求（`cross-site` / `same-site`）一律拒绝。
```

`packages/web/dist/assets/` 下的文件名带内容哈希，后端按 `immutable` 长缓存；`index.html` 是 `no-cache`，所以发版后用户刷新即可。

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

## 本机部署（wanzii-home-server）

- 源码 `/home/wanzii/code/party-music-player`，运行副本 `/opt/wanzii/party-music-player`（拷贝部署）；数据在 `data/`（`app.db` 含明文网易云 Cookie，目录 0700）。
- 服务单元 `party-music-player.service`，`.env` 设 `HOST=::`、`PORT=8095`，双栈监听 `[::]:8095`。
- 单元设置 `TMPDIR=data/tmp`，`ExecStartPre` 运行 `scripts/prepare-netease.cjs`，补齐网易云接口库需要的 `xeapi_public_key` 与 `anonymous_token`；缺公钥时搜索能用，但播放地址会报 `xeapi public key is missing`。
- 首次启动的管理员密码只在 journal 里打印一次：`sudo journalctl -u party-music-player -n 50 | grep -A3 已创建管理员账号`，登录后立即修改。
- 防火墙只放行 IPv6：`sudo ufw allow from ::/0 to any port 8095 proto tcp`。公网访问是纯 HTTP，密码和登录 Cookie 明文传输；正式对外使用前应加 TLS 反向代理。
- 更新：在源码目录 `npm install && npm run build`，把仓库文件覆盖到运行目录（排除 `node_modules`、`.git`、`data`、`.env`），在运行目录 `npm ci --omit=dev`，再 `sudo systemctl restart party-music-player`。
