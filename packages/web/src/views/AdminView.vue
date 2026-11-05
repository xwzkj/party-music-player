<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { MeView } from '@pmp/shared'
import { del, get, patch, post } from '../api/http'
import { ask, checked, toast, toastError, val } from '../ui'

type AdminUser = MeView & { createdAt: number; neteaseBound: boolean }
interface SysSettings {
  emailVerificationEnabled: boolean
  turnstileEnabled: boolean
  smtpConfigured: boolean
  turnstileConfigured: boolean
}

const router = useRouter()
const users = ref<AdminUser[]>([])
const sys = ref<SysSettings | null>(null)
const newUser = ref({ username: '', password: '', canCreateRoom: false })
const testTo = ref('')

async function load(): Promise<void> {
  try {
    users.value = await get<AdminUser[]>('/admin/users')
    sys.value = await get<SysSettings>('/admin/settings')
  } catch (e) {
    toastError(e)
  }
}
onMounted(load)

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
    <mdui-button-icon @click="router.push('/')"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
    <mdui-top-app-bar-title>管理后台</mdui-top-app-bar-title>
  </mdui-top-app-bar>
  <div class="page page-wide stack">
    <div class="title-medium">系统设置</div>
    <template v-if="sys">
      <div class="row">
        <div class="spacer">
          <div>邮箱验证</div>
          <div class="muted">{{ sys.smtpConfigured ? '开启后注册需要验证邮箱，并可自助找回密码' : '未配置 SMTP，不能开启' }}</div>
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
          <div class="muted">{{ sys.turnstileConfigured ? '保护注册与找回密码' : '未配置站点密钥，不能开启' }}</div>
        </div>
        <mdui-switch
          :checked="sys.turnstileEnabled"
          :disabled="!sys.turnstileConfigured"
          @change="setSys('turnstileEnabled', checked($event))"
        ></mdui-switch>
      </div>
      <div v-if="sys.smtpConfigured" class="row">
        <mdui-text-field class="spacer" label="测试收件邮箱" :value="testTo" @input="testTo = val($event)" />
        <mdui-button variant="tonal" @click="testEmail">发测试邮件</mdui-button>
      </div>
    </template>

    <div class="title-medium">新建用户</div>
    <div class="row" style="flex-wrap: wrap">
      <mdui-text-field label="用户名" :value="newUser.username" @input="newUser.username = val($event)" />
      <mdui-text-field label="初始密码" :value="newUser.password" @input="newUser.password = val($event)" />
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
