<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MeView } from '@pmp/shared'
import { patch, post } from '../api/http'
import { useAuth } from '../stores/auth'
import { toast, toastError, val } from '../ui'
import AuthShell from '../components/AuthShell.vue'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const me = auth.me!
const needPw = me.mustChangePassword
const canRename = me.canRenameOnce
const nickname = ref(me.nickname ?? '')
const oldPassword = ref('')
const newPassword = ref('')
const username = ref(me.username)
const busy = ref(false)

async function submit(): Promise<void> {
  busy.value = true
  try {
    if (auth.me!.mustChangePassword) {
      if (newPassword.value.length < 8) throw new Error('新密码至少 8 位')
      auth.set(await post<MeView>('/me/password', { oldPassword: oldPassword.value, newPassword: newPassword.value }))
    }
    if (auth.me!.canRenameOnce && username.value && username.value !== auth.me!.username) {
      auth.set(await post<MeView>('/me/username', { username: username.value }))
    }
    auth.set(await patch<MeView>('/me', { nickname: nickname.value }))
    toast('设置完成')
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/'
    await router.replace(next)
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell title="欢迎">
    <div class="muted">开始之前，先设置一个昵称，房间里的其他人会看到它。</div>
    <mdui-text-field
      variant="outlined"
      label="昵称"
      helper="1 到 16 字"
      :value="nickname"
      @input="nickname = val($event)"
    />
    <template v-if="canRename">
      <mdui-text-field
        variant="outlined"
        label="用户名"
        helper="管理员可以在首次登录时改一次用户名"
        :value="username"
        @input="username = val($event)"
      />
    </template>
    <template v-if="needPw">
      <div class="muted">初始密码需要修改后才能继续使用。</div>
      <mdui-text-field
        variant="outlined"
        label="当前密码"
        type="password"
        :value="oldPassword"
        @input="oldPassword = val($event)"
        autocomplete="current-password"
      />
      <mdui-text-field
        variant="outlined"
        label="新密码"
        type="password"
        helper="8 到 64 位"
        toggle-password
        :value="newPassword"
        @input="newPassword = val($event)"
        autocomplete="new-password"
      />
    </template>
    <mdui-button :loading="busy" @click="submit">完成</mdui-button>
  </AuthShell>
</template>
