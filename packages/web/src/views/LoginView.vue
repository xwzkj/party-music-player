<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthShell from '../components/AuthShell.vue'
import { useAuth } from '../stores/auth'
import { toastError, val } from '../ui'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const busy = ref(false)

async function submit(): Promise<void> {
  if (!username.value || !password.value) return
  busy.value = true
  try {
    await auth.login(username.value, password.value)
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
  <AuthShell title="欢迎回来" subtitle="大家一起点歌、投票，按得分决定播放顺序。">
    <div class="stack" @keydown.enter="submit">
      <mdui-text-field label="用户名" :value="username" @input="username = val($event)" autocomplete="username" />
      <mdui-text-field
        label="密码"
        type="password"
        toggle-password
        :value="password"
        @input="password = val($event)"
        autocomplete="current-password"
      />
      <mdui-button :loading="busy" full-width @click="submit">登录</mdui-button>
    </div>
    <template #foot>
      <RouterLink :to="{ path: '/register', query: route.query }">注册账号</RouterLink>
      <span class="spacer"></span>
      <RouterLink v-if="auth.config.emailVerificationEnabled" to="/forgot-password">忘记密码</RouterLink>
      <span v-else class="muted">忘记密码请联系管理员</span>
    </template>
  </AuthShell>
</template>
