<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { MeView } from '@pmp/shared'
import { patch, post } from '../api/http'
import NeteaseBind from '../components/NeteaseBind.vue'
import { useAuth } from '../stores/auth'
import { usePrefs, type ThemeMode } from '../stores/prefs'
import { toast, toastError, val } from '../ui'

const auth = useAuth()
const prefs = usePrefs()
const router = useRouter()
const nickname = ref(auth.me?.nickname ?? '')
const oldPassword = ref('')
const newPassword = ref('')
const email = ref(auth.me?.email ?? '')
const emailCode = ref('')
const emailSent = ref(false)

function onTheme(e: Event): void {
  const v = val(e)
  if (v === 'light' || v === 'dark' || v === 'auto') prefs.theme = v as ThemeMode
}

async function saveNickname(): Promise<void> {
  try {
    auth.set(await patch<MeView>('/me', { nickname: nickname.value }))
    toast('昵称已保存')
  } catch (e) {
    toastError(e)
  }
}

async function changePassword(): Promise<void> {
  try {
    auth.set(await post<MeView>('/me/password', { oldPassword: oldPassword.value, newPassword: newPassword.value }))
    oldPassword.value = ''
    newPassword.value = ''
    toast('密码已修改，其他设备需要重新登录')
  } catch (e) {
    toastError(e)
  }
}

async function changeEmail(): Promise<void> {
  try {
    const r = await post<{ result: 'sent' | 'saved'; me: MeView }>('/me/email', {
      email: email.value,
      code: emailSent.value ? emailCode.value : undefined,
    })
    auth.set(r.me)
    if (r.result === 'sent') {
      emailSent.value = true
      toast('验证码已发送到新邮箱')
    } else {
      emailSent.value = false
      emailCode.value = ''
      toast('邮箱已保存')
    }
  } catch (e) {
    toastError(e)
  }
}
</script>

<template>
  <mdui-top-app-bar>
    <mdui-button-icon @click="router.back()"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
    <mdui-top-app-bar-title>个人设置</mdui-top-app-bar-title>
  </mdui-top-app-bar>
  <div class="page stack">
    <div class="muted">用户名：{{ auth.me?.username }}</div>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">昵称</div>
      <div class="row">
        <mdui-text-field class="spacer" :value="nickname" @input="nickname = val($event)" />
        <mdui-button variant="tonal" @click="saveNickname">保存</mdui-button>
      </div>
    </mdui-card>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">主题</div>
      <mdui-segmented-button-group selects="single" full-width :value="prefs.theme" @change="onTheme">
        <mdui-segmented-button value="light">浅色</mdui-segmented-button>
        <mdui-segmented-button value="dark">深色</mdui-segmented-button>
        <mdui-segmented-button value="auto">跟随系统</mdui-segmented-button>
      </mdui-segmented-button-group>
    </mdui-card>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">网易云账号</div>
      <NeteaseBind />
    </mdui-card>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">修改密码</div>
      <mdui-text-field label="当前密码" type="password" :value="oldPassword" @input="oldPassword = val($event)" />
      <mdui-text-field
        label="新密码"
        type="password"
        toggle-password
        helper="8 到 64 位"
        :value="newPassword"
        @input="newPassword = val($event)"
      />
      <div class="row">
        <span class="spacer"></span><mdui-button variant="tonal" @click="changePassword">修改密码</mdui-button>
      </div>
    </mdui-card>

    <mdui-card variant="filled" class="card-pad stack">
      <div class="title-medium">邮箱</div>
      <div class="muted" v-if="auth.me?.email">
        当前：{{ auth.me.email }}{{ auth.me.emailVerified ? '（已验证）' : '（未验证）' }}
      </div>
      <mdui-text-field label="新邮箱" type="email" :value="email" @input="email = val($event)" />
      <mdui-text-field v-if="emailSent" label="验证码" :value="emailCode" @input="emailCode = val($event)" />
      <div class="row">
        <span class="spacer"></span>
        <mdui-button variant="tonal" @click="changeEmail">
          {{ emailSent ? '确认修改' : auth.config.emailVerificationEnabled ? '发送验证码' : '保存邮箱' }}
        </mdui-button>
      </div>
    </mdui-card>
  </div>
</template>
