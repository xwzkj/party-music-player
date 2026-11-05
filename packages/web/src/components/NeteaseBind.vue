<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { QrStatus } from '@pmp/shared'
import { del, get, post } from '../api/http'
import { ask, toast, toastError } from '../ui'

/** showOnHost：在房间里点"在房主屏幕上显示二维码"时传入房间号 */
const props = defineProps<{ showOnHost?: string }>()
const emit = defineEmits<{ changed: [] }>()

type Me = { bound: false } | { bound: true; nickname: string; uid: string; vip: boolean }
const me = ref<Me | null>(null)
const qr = ref<{ key: string; qrImage: string } | null>(null)
const status = ref<QrStatus['status'] | null>(null)
let poll: number | null = null

async function load(): Promise<void> {
  try {
    me.value = await get<Me>('/netease/me')
  } catch (e) {
    toastError(e)
  }
}

function stopPoll(): void {
  if (poll !== null) clearInterval(poll)
  poll = null
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
onBeforeUnmount(stopPoll)

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
      <div v-if="qr" class="stack center">
        <img v-if="qr.qrImage" :src="qr.qrImage" alt="二维码" width="200" height="200" style="margin: 0 auto" />
        <div class="muted">{{ status ? statusText[status] : '' }}</div>
        <mdui-button v-if="status === 'expired'" variant="tonal" @click="start(false)">刷新二维码</mdui-button>
      </div>
      <div v-else class="row">
        <mdui-button variant="tonal" @click="start(false)">
          <mdui-icon-qr-code-2 slot="icon"></mdui-icon-qr-code-2>扫码绑定
        </mdui-button>
        <mdui-button v-if="showOnHost" variant="text" @click="start(true)">在房主屏幕上显示二维码</mdui-button>
      </div>
    </template>
  </div>
</template>
