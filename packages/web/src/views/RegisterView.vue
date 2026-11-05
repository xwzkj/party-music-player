<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { MeView } from '@pmp/shared'
import { post } from '../api/http'
import TurnstileWidget from '../components/TurnstileWidget.vue'
import { useAuth } from '../stores/auth'
import { toast, toastError, val } from '../ui'
import AuthShell from '../components/AuthShell.vue'

const auth = useAuth()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const password2 = ref('')
const email = ref('')
const emailCode = ref('')
const turnstileToken = ref('')
const busy = ref(false)
const cooldown = ref(0)
const ts = ref<InstanceType<typeof TurnstileWidget> | null>(null)

const verify = computed(() => auth.config.emailVerificationEnabled)
const turnstile = computed(() => auth.config.turnstileEnabled && auth.config.turnstileSiteKey)

async function sendCode(): Promise<void> {
  if (!email.value) return toast('请填写邮箱')
  if (turnstile.value && !turnstileToken.value) return toast('请先完成人机验证')
  try {
    await post('/auth/email-code', { email: email.value, turnstileToken: turnstileToken.value || undefined })
    toast('验证码已发送，请查收邮件')
    cooldown.value = 60
    const t = setInterval(() => {
      cooldown.value--
      if (cooldown.value <= 0) clearInterval(t)
    }, 1000)
  } catch (e) {
    toastError(e)
  } finally {
    ts.value?.reset()
  }
}

async function submit(): Promise<void> {
  if (password.value !== password2.value) return toast('两次输入的密码不一致')
  if (!verify.value && turnstile.value && !turnstileToken.value) return toast('请先完成人机验证')
  busy.value = true
  try {
    const me = await post<MeView>('/auth/register', {
      username: username.value,
      password: password.value,
      email: email.value || undefined,
      emailCode: verify.value ? emailCode.value : undefined,
      turnstileToken: !verify.value ? turnstileToken.value || undefined : undefined,
    })
    auth.set(me)
    await router.replace({ path: '/setup', query: route.query })
  } catch (e) {
    toastError(e)
    if (!verify.value) ts.value?.reset()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell title="创建账号">
    <div class="stack" @keydown.enter="submit">
      <mdui-text-field
        variant="outlined"
        label="用户名"
        helper="3 到 20 位字母、数字或下划线，注册后不能修改"
        :value="username"
        @input="username = val($event)"
        autocomplete="username"
      />
      <mdui-text-field
        variant="outlined"
        label="密码"
        type="password"
        helper="8 到 64 位"
        toggle-password
        :value="password"
        @input="password = val($event)"
        autocomplete="new-password"
      />
      <mdui-text-field
        variant="outlined"
        label="确认密码"
        type="password"
        :value="password2"
        @input="password2 = val($event)"
        autocomplete="new-password"
      />
      <mdui-text-field
        variant="outlined"
        :label="verify ? '邮箱' : '邮箱（可选）'"
        type="email"
        :value="email"
        @input="email = val($event)"
        autocomplete="email"
      />
      <TurnstileWidget v-if="turnstile" ref="ts" :site-key="auth.config.turnstileSiteKey!" @token="turnstileToken = $event" />
      <div v-if="verify" class="row">
        <mdui-text-field
          variant="outlined"
          class="spacer"
          label="邮箱验证码"
          :value="emailCode"
          @input="emailCode = val($event)"
        />
        <mdui-button variant="tonal" :disabled="cooldown > 0" @click="sendCode">
          {{ cooldown > 0 ? `${cooldown} 秒` : '发送验证码' }}
        </mdui-button>
      </div>
      <mdui-button :loading="busy" full-width @click="submit">注册</mdui-button>
    </div>
    <template #foot><RouterLink :to="{ path: '/login', query: route.query }">已有账号？去登录</RouterLink></template>
  </AuthShell>
</template>
