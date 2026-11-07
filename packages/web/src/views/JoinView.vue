<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { get, post } from '../api/http'
import { toastError, val } from '../ui'

const props = defineProps<{ code: string }>()
const router = useRouter()
const route = useRoute()
const loading = ref(true)
const open = ref(false)
const passcode = ref('')
const busy = ref(false)
/** 邀请链接里带了口令：/r/CODE?p=xxxx */
const invitePasscode = typeof route.query.p === 'string' ? route.query.p : ''

onMounted(async () => {
  try {
    const info = await get<{ open: boolean; joined: boolean }>(`/rooms/${props.code}`)
    open.value = info.open
    // 已经加入过就直接进房间
    if (info.open && info.joined) return void router.replace(`/r/${props.code}/room`)
    // 链接自带口令时直接加入，不再让用户手输
    if (info.open && invitePasscode) {
      passcode.value = invitePasscode
      await join()
      return
    }
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
})

async function join(): Promise<void> {
  busy.value = true
  try {
    await post(`/rooms/${props.code}/join`, { passcode: passcode.value })
    await router.replace(`/r/${props.code}/room`)
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page stack">
    <div class="row">
      <mdui-button-icon @click="router.push('/')"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
      <div class="title-large">房间 {{ code }}</div>
    </div>
    <mdui-circular-progress v-if="loading"></mdui-circular-progress>
    <template v-else-if="!open">
      <div class="muted">房间不存在或已关闭。</div>
      <mdui-button @click="router.push('/')">回到首页</mdui-button>
    </template>
    <template v-else>
      <mdui-text-field
        variant="outlined"
        label="房间口令"
        :value="passcode"
        @input="passcode = val($event)"
        @keydown.enter="join"
        autofocus
      />
      <mdui-button :loading="busy" @click="join">加入</mdui-button>
    </template>
  </div>
</template>
