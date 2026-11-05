<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { NeteaseBinding, QrStatus } from '@pmp/shared'
import { del, get, post } from '../api/http'
import { ask, toast, toastError, val } from '../ui'

/** showOnHost：在房间里点"在房主屏幕上显示二维码"时传入房间号 */
const props = defineProps<{ showOnHost?: string }>()
const emit = defineEmits<{ changed: [] }>()

const me = ref<NeteaseBinding | null>(null)
const mode = ref<'qr' | 'phone'>('qr')

const qr = ref<{ key: string; qrImage: string } | null>(null)
const status = ref<QrStatus['status'] | null>(null)
let poll: number | null = null

const phone = ref('')
const code = ref('')
const sending = ref(false)
const binding = ref(false)
const cooldown = ref(0)
let countdown: number | null = null

const phoneValid = (): boolean => /^1[3-9]\d{9}$/.test(phone.value.trim())

async function load(): Promise<void> {
  try {
    me.value = await get<NeteaseBinding>('/netease/me')
  } catch (e) {
    toastError(e)
  }
}

function stopPoll(): void {
  if (poll !== null) clearInterval(poll)
  poll = null
}

function stopCountdown(): void {
  if (countdown !== null) clearInterval(countdown)
  countdown = null
}

function onMode(e: Event): void {
  const v = val(e)
  if (v !== 'qr' && v !== 'phone') return
  mode.value = v
  // 两种方式互斥，切走时把另一边没完成的状态收掉
  stopPoll()
  qr.value = null
  status.value = null
}

async function start(onHost: boolean): Promise<void> {
  stopPoll()
  try {
    qr.value = await post('/netease/login/qr', onHost && props.showOnHost ? { showOnHost: props.showOnHost } : {})
    status.value = 'waiting'
    if (onHost) toast('二维码已显示在房主屏幕上，请用网易云 App 扫码')
    // 每 2 秒轮询一次状态
    poll = window.setInterval(check, 2000)
  } catch (e) {
    toastError(e)
  }
}

async function check(): Promise<void> {
  if (!qr.value) return
  try {
    const r = await get<QrStatus>(`/netease/login/qr/${encodeURIComponent(qr.value.key)}`)
    status.value = r.status
    if (r.status === 'success') {
      stopPoll()
      qr.value = null
      toast('网易云账号绑定成功')
      await load()
      emit('changed')
    } else if (r.status === 'expired') {
      stopPoll()
    }
  } catch {
    /* 下次再试 */
  }
}

async function sendCode(): Promise<void> {
  if (sending.value || cooldown.value > 0) return
  if (!phoneValid()) return toast('请填写 11 位手机号')
  sending.value = true
  try {
    await post('/netease/login/captcha', { phone: phone.value.trim() })
    toast('验证码已发送，请查看短信')
    stopCountdown()
    cooldown.value = 60
    countdown = window.setInterval(() => {
      cooldown.value--
      if (cooldown.value <= 0) stopCountdown()
    }, 1000)
  } catch (e) {
    toastError(e)
  } finally {
    sending.value = false
  }
}

async function bind(): Promise<void> {
  if (binding.value) return
  if (!phoneValid()) return toast('请填写 11 位手机号')
  if (!/^\d{4,6}$/.test(code.value.trim())) return toast('请填写短信验证码')
  binding.value = true
  try {
    me.value = await post<NeteaseBinding>('/netease/login/phone', {
      phone: phone.value.trim(),
      captcha: code.value.trim(),
    })
    code.value = ''
    toast('网易云账号绑定成功')
    emit('changed')
  } catch (e) {
    toastError(e)
  } finally {
    binding.value = false
  }
}

async function unbind(): Promise<void> {
  if (!(await ask('解绑网易云账号？', '本站服务器上保存的网易云登录状态会立即删除。'))) return
  try {
    await del('/netease/me')
    await load()
    emit('changed')
  } catch (e) {
    toastError(e)
  }
}

onMounted(load)
onBeforeUnmount(() => {
  stopPoll()
  stopCountdown()
})

const statusText: Record<string, string> = {
  waiting: '等待扫码…',
  confirming: '已扫码，请在手机上确认',
  expired: '二维码已过期',
  success: '绑定成功',
}
</script>

<template>
  <div class="stack">
    <template v-if="me?.bound">
      <div class="row">
        <mdui-icon-music-note></mdui-icon-music-note>
        <div class="spacer">
          <div>{{ me.nickname }}</div>
          <div class="muted">{{ me.vip ? '黑胶会员' : '普通账号' }}</div>
        </div>
        <mdui-button variant="text" @click="unbind">解绑</mdui-button>
      </div>
    </template>
    <template v-else-if="me">
      <div class="muted">
        绑定后可以从自己的网易云歌单点歌。你的网易云登录状态会保存在本站服务器上，可随时解绑。
      </div>

      <mdui-segmented-button-group selects="single" full-width :value="mode" @change="onMode">
        <mdui-segmented-button value="qr">扫码绑定</mdui-segmented-button>
        <mdui-segmented-button value="phone">手机验证码</mdui-segmented-button>
      </mdui-segmented-button-group>

      <template v-if="mode === 'qr'">
        <div v-if="qr" class="stack center">
          <img v-if="qr.qrImage" :src="qr.qrImage" alt="二维码" width="200" height="200" style="margin: 0 auto" />
          <div class="muted">{{ status ? statusText[status] : '' }}</div>
          <mdui-button v-if="status === 'expired'" variant="tonal" @click="start(false)">刷新二维码</mdui-button>
        </div>
        <div v-else class="row wrap">
          <mdui-button variant="tonal" @click="start(false)">
            <mdui-icon-qr-code-2 slot="icon"></mdui-icon-qr-code-2>扫码绑定
          </mdui-button>
          <mdui-button v-if="showOnHost" variant="text" @click="start(true)">在房主屏幕上显示二维码</mdui-button>
        </div>
      </template>

      <template v-else>
        <mdui-text-field
          variant="outlined"
          label="手机号"
          type="tel"
          inputmode="numeric"
          maxlength="11"
          helper="填网易云账号绑定的手机号"
          :value="phone"
          @input="phone = val($event)"
        />
        <div class="row">
          <mdui-text-field
            variant="outlined"
            class="spacer"
            label="短信验证码"
            inputmode="numeric"
            maxlength="6"
            :value="code"
            @input="code = val($event)"
            @keydown.enter="bind"
          />
          <mdui-button variant="tonal" :disabled="cooldown > 0 || sending" @click="sendCode">
            {{ cooldown > 0 ? `${cooldown} 秒` : '获取验证码' }}
          </mdui-button>
        </div>
        <div class="row">
          <span class="spacer"></span>
          <mdui-button :loading="binding" @click="bind">绑定</mdui-button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.wrap {
  flex-wrap: wrap;
}
</style>
