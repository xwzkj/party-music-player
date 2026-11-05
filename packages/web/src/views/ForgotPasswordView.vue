<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { post } from '../api/http'
import TurnstileWidget from '../components/TurnstileWidget.vue'
import { useAuth } from '../stores/auth'
import { toast, toastError, val } from '../ui'
import AuthShell from '../components/AuthShell.vue'

const auth = useAuth()
const router = useRouter()
const account = ref('')
const code = ref('')
const password = ref('')
const turnstileToken = ref('')
const sent = ref(false)
const busy = ref(false)
const ts = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const turnstile = computed(() => auth.config.turnstileEnabled && auth.config.turnstileSiteKey)

async function request(): Promise<void> {
  if (!account.value) return
  if (turnstile.value && !turnstileToken.value) return toast('请先完成人机验证')
  busy.value = true
  try {
    await post('/auth/password-reset/request', { account: account.value, turnstileToken: turnstileToken.value || undefined })
    sent.value = true
    toast('如果账号存在并绑定了已验证的邮箱，重置码已发送')
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
    ts.value?.reset()
  }
}

async function confirm(): Promise<void> {
  busy.value = true
  try {
    await post('/auth/password-reset/confirm', { account: account.value, code: code.value, password: password.value })
    toast('密码已重置，请重新登录')
    await router.replace('/login')
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell title="找回密码">
    <template v-if="!auth.config.emailVerificationEnabled">
      <div class="muted">本站没有开启邮箱验证，请联系管理员重置密码。</div>
    </template>
    <template v-else>
      <mdui-text-field label="用户名或邮箱" :value="account" @input="account = val($event)" :disabled="sent" />
      <TurnstileWidget v-if="turnstile && !sent" ref="ts" :site-key="auth.config.turnstileSiteKey!" @token="turnstileToken = $event" />
      <mdui-button v-if="!sent" :loading="busy" @click="request">发送重置码</mdui-button>
      <template v-else>
        <mdui-text-field label="6 位重置码" :value="code" @input="code = val($event)" />
        <mdui-text-field label="新密码" type="password" toggle-password :value="password" @input="password = val($event)" />
        <mdui-button :loading="busy" @click="confirm">重置密码</mdui-button>
        <mdui-button variant="text" @click="sent = false">重新发送</mdui-button>
      </template>
    </template>
    <template #foot><RouterLink to="/login">返回登录</RouterLink></template>
  </AuthShell>
</template>
