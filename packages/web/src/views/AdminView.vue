<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { MeView } from '@pmp/shared'
import { del, get, patch, post, put } from '../api/http'
import { ask, checked, toast, toastError, val } from '../ui'

type AdminUser = MeView & { createdAt: number; neteaseBound: boolean }
interface SysSettings {
  emailVerificationEnabled: boolean
  turnstileEnabled: boolean
  smtpConfigured: boolean
  turnstileConfigured: boolean
}

interface Integrations {
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; passSet: boolean }
  turnstile: { siteKey: string; secretSet: boolean }
}

const router = useRouter()
/** 从房间菜单进来时回到房间，直接打开时回首页 */
function back(): void {
  if (window.history.state?.back) router.back()
  else void router.push('/')
}
const users = ref<AdminUser[]>([])
const sys = ref<SysSettings | null>(null)
const newUser = ref({ username: '', password: '', canCreateRoom: false })
const testTo = ref('')
const smtp = ref({ host: '', port: '465', secure: true, user: '', pass: '', from: '' })
const smtpPassSet = ref(false)
const ts = ref({ siteKey: '', secretKey: '' })
const tsSecretSet = ref(false)
const savingSmtp = ref(false)
const savingTs = ref(false)

async function load(): Promise<void> {
  try {
    users.value = await get<AdminUser[]>('/admin/users')
    sys.value = await get<SysSettings>('/admin/settings')
  } catch (e) {
    toastError(e)
  }
}

/** 配置表单只在进入页面时填充，保存后不覆盖用户正在编辑的内容 */
async function loadIntegrations(): Promise<void> {
  try {
    const r = await get<Integrations>('/admin/integrations')
    smtp.value = { host: r.smtp.host, port: String(r.smtp.port), secure: r.smtp.secure, user: r.smtp.user, pass: '', from: r.smtp.from }
    smtpPassSet.value = r.smtp.passSet
    ts.value = { siteKey: r.turnstile.siteKey, secretKey: '' }
    tsSecretSet.value = r.turnstile.secretSet
  } catch (e) {
    toastError(e)
  }
}
onMounted(() => {
  void load()
  void loadIntegrations()
})

async function saveSmtp(): Promise<void> {
  const port = Number(smtp.value.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return toast('端口应为 1 到 65535 的整数')
  savingSmtp.value = true
  try {
    const body: Record<string, unknown> = {
      smtpHost: smtp.value.host,
      smtpPort: port,
      smtpSecure: smtp.value.secure,
      smtpUser: smtp.value.user,
      smtpFrom: smtp.value.from,
    }
    // 密码留空表示不修改
    if (smtp.value.pass) body.smtpPass = smtp.value.pass
    await put('/admin/integrations', body)
    toast('SMTP 配置已保存')
    await Promise.all([load(), loadIntegrations()])
  } catch (e) {
    toastError(e)
  } finally {
    savingSmtp.value = false
  }
}

async function clearSmtpPass(): Promise<void> {
  try {
    await put('/admin/integrations', { smtpPass: '' })
    toast('已清除 SMTP 密码')
    await loadIntegrations()
  } catch (e) {
    toastError(e)
  }
}

async function saveTurnstile(): Promise<void> {
  savingTs.value = true
  try {
    const body: Record<string, unknown> = { turnstileSiteKey: ts.value.siteKey }
    // 私钥留空表示不修改
    if (ts.value.secretKey) body.turnstileSecretKey = ts.value.secretKey
    await put('/admin/integrations', body)
    toast('Turnstile 配置已保存')
    await Promise.all([load(), loadIntegrations()])
  } catch (e) {
    toastError(e)
  } finally {
    savingTs.value = false
  }
}

async function toggleCreate(u: AdminUser, v: boolean): Promise<void> {
  try {
    await patch(`/admin/users/${u.id}`, { canCreateRoom: v })
    await load()
  } catch (e) {
    toastError(e)
  }
}

async function resetPassword(u: AdminUser): Promise<void> {
  const pw = window.prompt(`为 ${u.username} 设置新密码（8 到 64 位），对方下次登录必须修改：`)
  if (!pw) return
  try {
    await patch(`/admin/users/${u.id}`, { password: pw })
    toast('密码已重置，旧的登录态已失效')
  } catch (e) {
    toastError(e)
  }
}

async function remove(u: AdminUser): Promise<void> {
  if (!(await ask(`删除用户 ${u.username}？`, '他的房间会被关闭，网易云绑定会被删除。此操作不可撤销。', '删除'))) return
  try {
    await del(`/admin/users/${u.id}`)
    await load()
  } catch (e) {
    toastError(e)
  }
}

async function create(): Promise<void> {
  try {
    await post('/admin/users', newUser.value)
    newUser.value = { username: '', password: '', canCreateRoom: false }
    toast('用户已创建，首次登录需修改密码')
    await load()
  } catch (e) {
    toastError(e)
  }
}

async function setSys(key: 'emailVerificationEnabled' | 'turnstileEnabled', v: boolean): Promise<void> {
  try {
    await patch('/admin/settings', { [key]: v })
  } catch (e) {
    toastError(e)
  }
  await load()
}

async function testEmail(): Promise<void> {
  try {
    await post('/admin/settings/test-email', { to: testTo.value })
    toast('测试邮件已发送')
  } catch (e) {
    toastError(e)
  }
}
</script>

<template>
  <mdui-top-app-bar>
    <mdui-button-icon @click="back"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
    <mdui-top-app-bar-title>管理后台</mdui-top-app-bar-title>
  </mdui-top-app-bar>
  <div class="page page-wide stack">
    <div class="title-medium">系统设置</div>
    <template v-if="sys">
      <div class="row">
        <div class="spacer">
          <div>邮箱验证</div>
          <div class="muted">{{ sys.smtpConfigured ? '开启后注册需要验证邮箱，并可自助找回密码' : '未配置 SMTP，不能开启（见下方 SMTP 配置）' }}</div>
        </div>
        <mdui-switch
          :checked="sys.emailVerificationEnabled"
          :disabled="!sys.smtpConfigured"
          @change="setSys('emailVerificationEnabled', checked($event))"
        ></mdui-switch>
      </div>
      <div class="row">
        <div class="spacer">
          <div>Turnstile 人机验证</div>
          <div class="muted">{{ sys.turnstileConfigured ? '保护注册与找回密码' : '未配置站点密钥和私钥，不能开启（见下方 Turnstile 配置）' }}</div>
        </div>
        <mdui-switch
          :checked="sys.turnstileEnabled"
          :disabled="!sys.turnstileConfigured"
          @change="setSys('turnstileEnabled', checked($event))"
        ></mdui-switch>
      </div>
      <div v-if="sys.smtpConfigured" class="row">
        <mdui-text-field
          variant="outlined"
          class="spacer"
          label="测试收件邮箱"
          :value="testTo"
          @input="testTo = val($event)"
        />
        <mdui-button variant="tonal" @click="testEmail">发测试邮件</mdui-button>
      </div>
    </template>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">SMTP 配置</div>
      <div class="muted">保存后立即生效，优先于环境变量。清空某一项再保存即可退回环境变量。</div>
      <div class="grid">
        <mdui-text-field variant="outlined" label="服务器" placeholder="smtp.example.com" :value="smtp.host" @input="smtp.host = val($event)" />
        <mdui-text-field variant="outlined" label="端口" inputmode="numeric" :value="smtp.port" @input="smtp.port = val($event)" />
        <mdui-text-field variant="outlined" label="用户名" autocomplete="off" :value="smtp.user" @input="smtp.user = val($event)" />
        <mdui-text-field
          variant="outlined"
          label="密码"
          type="password"
          toggle-password
          autocomplete="new-password"
          :helper="smtpPassSet ? '已设置，留空表示不修改' : '未设置'"
          :value="smtp.pass"
          @input="smtp.pass = val($event)"
        />
        <mdui-text-field
          class="wide"
          variant="outlined"
          label="发件人"
          placeholder="聚会音乐播放器 <noreply@example.com>"
          :value="smtp.from"
          @input="smtp.from = val($event)"
        />
      </div>
      <div class="row">
        <mdui-switch :checked="smtp.secure" @change="smtp.secure = checked($event)"></mdui-switch>
        <span class="spacer">使用 SSL/TLS（465 端口通常开启，587 通常关闭）</span>
      </div>
      <div class="row">
        <mdui-button v-if="smtpPassSet" variant="text" @click="clearSmtpPass">清除密码</mdui-button>
        <span class="spacer"></span>
        <mdui-button variant="tonal" :loading="savingSmtp" @click="saveSmtp">保存</mdui-button>
      </div>
    </mdui-card>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">Turnstile 配置</div>
      <div class="muted">在 Cloudflare 后台创建 Turnstile 站点后，把站点密钥和私钥填在这里。</div>
      <mdui-text-field variant="outlined" label="站点密钥（Site Key）" :value="ts.siteKey" @input="ts.siteKey = val($event)" />
      <mdui-text-field
        variant="outlined"
        label="私钥（Secret Key）"
        type="password"
        toggle-password
        autocomplete="new-password"
        :helper="tsSecretSet ? '已设置，留空表示不修改' : '未设置'"
        :value="ts.secretKey"
        @input="ts.secretKey = val($event)"
      />
      <div class="row">
        <span class="spacer"></span>
        <mdui-button variant="tonal" :loading="savingTs" @click="saveTurnstile">保存</mdui-button>
      </div>
    </mdui-card>

    <div class="title-medium">新建用户</div>
    <div class="row" style="flex-wrap: wrap">
      <mdui-text-field
        variant="outlined"
        label="用户名"
        :value="newUser.username"
        @input="newUser.username = val($event)"
      />
      <mdui-text-field
        variant="outlined"
        label="初始密码"
        :value="newUser.password"
        @input="newUser.password = val($event)"
      />
      <mdui-checkbox :checked="newUser.canCreateRoom" @change="newUser.canCreateRoom = checked($event)">可以建房</mdui-checkbox>
      <mdui-button @click="create">创建</mdui-button>
    </div>

    <div class="title-medium">用户（{{ users.length }}）</div>
    <mdui-list>
      <mdui-list-item v-for="u in users" :key="u.id" nonclickable>
        {{ u.nickname || '（未设置昵称）' }}
        <span slot="description">
          {{ u.username }} · {{ u.role === 'admin' ? '管理员' : '用户' }}
          {{ u.email ? ` · ${u.email}` : '' }}{{ u.neteaseBound ? ' · 已绑定网易云' : '' }}
        </span>
        <div slot="end-icon" class="row">
          <mdui-checkbox
            v-if="u.role !== 'admin'"
            :checked="u.canCreateRoom"
            @change="toggleCreate(u, checked($event))"
            >可建房</mdui-checkbox
          >
          <mdui-button variant="text" @click="resetPassword(u)">重置密码</mdui-button>
          <mdui-button-icon v-if="u.role !== 'admin'" @click="remove(u)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
        </div>
      </mdui-list-item>
    </mdui-list>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}
.wide {
  grid-column: 1 / -1;
}
@media (min-width: 640px) {
  .grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
