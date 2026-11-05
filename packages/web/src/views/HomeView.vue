<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api/http'
import { useAuth } from '../stores/auth'
import { toast, toastError, val } from '../ui'

const auth = useAuth()
const router = useRouter()
const code = ref('')
const newPasscode = ref('')
const myRooms = ref<{ code: string; isOwner: boolean; memberCount: number }[]>([])
const creating = ref(false)

onMounted(async () => {
  try {
    myRooms.value = await get('/rooms')
  } catch {
    /* ignore */
  }
})

function goJoin(): void {
  if (!/^\d{6}$/.test(code.value)) return toast('房间号是 6 位数字')
  void router.push(`/r/${code.value}`)
}

async function create(): Promise<void> {
  creating.value = true
  try {
    const r = await post<{ code: string; passcode: string }>('/rooms', { passcode: newPasscode.value || undefined })
    toast(`房间已创建，口令 ${r.passcode}`)
    await router.push(`/r/${r.code}/room`)
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}

async function logout(): Promise<void> {
  await auth.logout()
  await router.replace('/login')
}
</script>

<template>
  <mdui-top-app-bar>
    <mdui-avatar class="logo"><mdui-icon-music-note></mdui-icon-music-note></mdui-avatar>
    <mdui-top-app-bar-title>聚会音乐播放器</mdui-top-app-bar-title>
    <div class="spacer"></div>
    <mdui-button-icon v-if="auth.me?.role === 'admin'" title="管理后台" @click="router.push('/admin')">
      <mdui-icon-admin-panel-settings></mdui-icon-admin-panel-settings>
    </mdui-button-icon>
    <mdui-button-icon title="个人设置" @click="router.push('/settings')"><mdui-icon-settings></mdui-icon-settings></mdui-button-icon>
    <mdui-button-icon title="退出登录" @click="logout"><mdui-icon-logout></mdui-icon-logout></mdui-button-icon>
  </mdui-top-app-bar>
  <div class="page page-wide stack">
    <div class="hello">
      <div class="muted">你好，{{ auth.me?.nickname }}</div>
      <h1 class="display-small">今晚放点什么？</h1>
    </div>

    <div class="cards">
      <mdui-card variant="filled">
        <div class="card-pad stack">
          <div class="title-medium">加入房间</div>
          <mdui-text-field
            label="6 位房间号"
            inputmode="numeric"
            maxlength="6"
            :value="code"
            @input="code = val($event)"
            @keydown.enter="goJoin"
          />
          <div class="row"><span class="spacer"></span><mdui-button @click="goJoin">进入</mdui-button></div>
        </div>
      </mdui-card>

      <mdui-card v-if="auth.me?.canCreateRoom" variant="filled">
        <div class="card-pad stack">
          <div class="title-medium">创建房间</div>
          <mdui-text-field
            label="口令（可选）"
            helper="4 到 16 位；不填就随机生成 4 位数字"
            :value="newPasscode"
            @input="newPasscode = val($event)"
          />
          <div class="row">
            <span class="spacer"></span><mdui-button variant="tonal" :loading="creating" @click="create">创建</mdui-button>
          </div>
        </div>
      </mdui-card>
    </div>

    <template v-if="myRooms.length">
      <div class="title-medium">我的房间</div>
      <div class="rooms">
        <mdui-card v-for="r in myRooms" :key="r.code" variant="outlined" clickable @click="router.push(`/r/${r.code}/room`)">
          <div class="card-pad">
            <div class="headline-small">{{ r.code }}</div>
            <div class="muted">{{ r.isOwner ? '我是房主 · ' : '' }}{{ r.memberCount }} 人</div>
          </div>
        </mdui-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.logo {
  width: 32px;
  height: 32px;
  margin-left: 8px;
}
.hello {
  padding: 16px 0 8px;
}
h1 {
  margin: 4px 0 0;
}
.cards {
  display: grid;
  gap: 16px;
  align-items: start;
}
.cards mdui-card {
  width: 100%;
}
@media (min-width: 720px) {
  .cards {
    grid-template-columns: 1fr 1fr;
  }
}
.rooms {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
</style>
