<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChatPanel from '../components/ChatPanel.vue'
import ChatSheet from '../components/ChatSheet.vue'
import HostSettingsDialog from '../components/HostSettingsDialog.vue'
import MembersDialog from '../components/MembersDialog.vue'
import NowPlayingSheet from '../components/NowPlayingSheet.vue'
import PlayerBar from '../components/PlayerBar.vue'
import PlaylistsPanel from '../components/PlaylistsPanel.vue'
import QueueSheet from '../components/QueueSheet.vue'
import RoomInfoDialog from '../components/RoomInfoDialog.vue'
import SearchPanel from '../components/SearchPanel.vue'
import { useAuth } from '../stores/auth'
import { useRoom } from '../stores/room'
import { applyCoverColor } from '../theme'
import { ask, checked, copyText, toast, val } from '../ui'

const props = defineProps<{ code: string }>()
const router = useRouter()
const room = useRoom()
const auth = useAuth()
const tab = ref<'search' | 'playlists' | 'chat'>('search')
const showPlayer = ref(false)
const showQueue = ref(false)
const showChat = ref(false)
const showSettings = ref(false)
const showMembers = ref(false)
const showRoomInfo = ref(false)
const unread = ref(0)
let decided = false
/** 已处理过的最后一条聊天，避免首次加载历史时弹一堆提醒 */
let lastChatId: string | null = null
let lastToastAt = 0

const s = computed(() => room.snap)
const panes = { search: SearchPanel, playlists: PlaylistsPanel, chat: ChatPanel }

// 底部栏（播放条 + 导航栏）的高度写成 CSS 变量，toast 据此抬高，避免盖住底部导航
const bottomItem = ref<HTMLElement | null>(null)
let bottomObserver: ResizeObserver | null = null

function syncBottomOffset(): void {
  const el = bottomItem.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  const offset = Math.max(0, document.documentElement.clientHeight - top)
  document.documentElement.style.setProperty('--app-toast-offset', `${Math.round(offset)}px`)
}

onMounted(() => {
  void room.open(props.code)
  void nextTick(() => {
    syncBottomOffset()
    if (bottomItem.value && typeof ResizeObserver !== 'undefined') {
      bottomObserver = new ResizeObserver(syncBottomOffset)
      bottomObserver.observe(bottomItem.value)
    }
    window.addEventListener('resize', syncBottomOffset)
  })
})
onBeforeUnmount(() => {
  bottomObserver?.disconnect()
  window.removeEventListener('resize', syncBottomOffset)
  document.documentElement.style.removeProperty('--app-toast-offset')
  document.title = '聚会音乐播放器'
  room.detach()
  void applyCoverColor(null)
})

// 第一份快照到达后决定本机是否出声
watch(
  () => room.snap,
  async (snap) => {
    if (!snap || decided) return
    decided = true
    if (room.initialListening()) {
      // 刚点过按钮（例如建房）时浏览器允许直接出声；否则提示再点一次
      await room.setListening(true)
      if (!room.listening) room.needsUnlock = true
    }
  },
)

watch(
  () => s.value?.nowPlaying?.item.track.coverUrl,
  (url) => void applyCoverColor(url),
  { immediate: true },
)

function setTab(e: Event): void {
  const v = val(e)
  if (v === 'search' || v === 'playlists' || v === 'chat') tab.value = v
}

// 不在聊天页时，别人发的新消息用 toast + 未读徽标提醒
watch(
  () => room.chats.length,
  (len, prevLen) => {
    if (!len) {
      // 离开房间或切换房间时数组会清空，重置基线，免得把下个房间的历史当成新消息
      lastChatId = null
      return
    }
    // 删除消息会让长度变小，不是新消息
    if (prevLen !== undefined && len < prevLen) return
    const m = room.chats[len - 1]
    if (!m) return
    if (lastChatId === null) {
      // 首次加载房间历史：记住最后一条，但不提醒
      lastChatId = m.id
      return
    }
    if (m.id === lastChatId) return
    lastChatId = m.id
    if (m.kind !== 'user' || !m.userId || m.userId === room.snap?.me.userId) return
    // 只有聊天真正显示在眼前时才不算未读
    if (chatVisible.value) return
    unread.value++
    // 页面在后台时只记未读，回来不会一口气弹一串
    if (document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - lastToastAt < 1500) return
    lastToastAt = now
    const preview = m.content.replace(/\s+/g, ' ').trim().slice(0, 40)
    toast(`${m.nickname ?? '有人'}：${preview}`)
  },
)

/**
 * 聊天是否正显示在用户眼前：聊天覆盖层打开，或者在聊天页且没有被播放页、播放列表盖住。
 * 播放页盖在聊天页上时，底下的聊天看不见，新消息要计未读并提醒。
 */
const chatVisible = computed(() => showChat.value || (tab.value === 'chat' && !showPlayer.value && !showQueue.value))

// 聊天变为可见（切到聊天页、关掉盖在上面的面板、打开聊天覆盖层）时清零未读
watch(chatVisible, (v) => {
  if (v) unread.value = 0
})

// 页面在后台时也能从标签页标题看到未读数
const baseTitle = '聚会音乐播放器'
watch(unread, (n) => {
  document.title = n > 0 ? `(${n}) ${baseTitle}` : baseTitle
})

async function toggleListening(e: Event): Promise<void> {
  const on = checked(e)
  await room.setListening(on)
  // 被浏览器拦截时把开关拨回去
  ;(e.target as HTMLInputElement).checked = room.listening
}

async function leaveRoom(): Promise<void> {
  if (!(await ask('离开房间？', '离开后再回来不用重新输入口令。'))) return
  await room.leave()
  await router.replace('/')
}

/** 左上角的 home：先确认，避免误触把房间页面关掉 */
async function goHome(): Promise<void> {
  if (!(await ask('退出房间？', '回到首页后需要重新输入口令才能进来。', '退出'))) return
  await router.replace('/')
}

/** 房间已经关了/被踢时直接回首页 */
function backHome(): void {
  void router.replace('/')
}

async function copyInvite(): Promise<void> {
  const text = `${location.origin}/r/${props.code}`
  if (await copyText(text)) return toast('邀请链接已复制')
  // 复制失败时打开房间信息，里面的链接可以手动选中复制
  showRoomInfo.value = true
  toast('浏览器不允许自动复制，请在房间信息里手动复制链接')
}

/** 房间设置之外的两个页面。离开房间页会断开连接，回来时自动重新进入 */
function goSettings(): void {
  void router.push('/settings')
}
function goAdmin(): void {
  void router.push('/admin')
}
</script>

<template>
  <mdui-layout class="room-layout">
    <mdui-top-app-bar>
      <mdui-button-icon title="退出房间" @click="goHome"><mdui-icon-home></mdui-icon-home></mdui-button-icon>
      <mdui-top-app-bar-title>{{ room.presentCount }} 人在场</mdui-top-app-bar-title>
      <mdui-dropdown placement="bottom-end">
        <mdui-button-icon slot="trigger" title="更多"><mdui-icon-more-vert></mdui-icon-more-vert></mdui-button-icon>
        <mdui-menu>
          <mdui-menu-item @click="showMembers = true">成员{{ room.isHost ? '与禁入' : '' }}</mdui-menu-item>
          <mdui-menu-item @click="showRoomInfo = true">房间信息</mdui-menu-item>
          <mdui-menu-item @click="copyInvite">复制邀请链接</mdui-menu-item>
          <mdui-menu-item class="listen-item">
            <span class="row listen" @click.stop @pointerdown.stop>
              <mdui-icon-headphones></mdui-icon-headphones>
              <span>本机出声</span>
              <span class="spacer"></span>
              <mdui-switch :checked="room.listening" @change="toggleListening" @click.stop></mdui-switch>
            </span>
          </mdui-menu-item>
          <mdui-menu-item v-if="room.isHost" @click="showSettings = true">房间设置</mdui-menu-item>
          <mdui-menu-item @click="goSettings">账号设置</mdui-menu-item>
          <mdui-menu-item v-if="auth.me?.role === 'admin'" @click="goAdmin">管理后台</mdui-menu-item>
          <mdui-menu-item v-else @click="leaveRoom">离开房间</mdui-menu-item>
        </mdui-menu>
      </mdui-dropdown>
    </mdui-top-app-bar>

    <mdui-navigation-bar :value="tab" @change="setTab" label-visibility="labeled">
      <mdui-navigation-bar-item value="search"><mdui-icon-search slot="icon"></mdui-icon-search>搜索</mdui-navigation-bar-item>
      <mdui-navigation-bar-item value="playlists">
        <mdui-icon-library-music slot="icon"></mdui-icon-library-music>我的歌单
      </mdui-navigation-bar-item>
      <mdui-navigation-bar-item value="chat">
        <mdui-icon-chat slot="icon"></mdui-icon-chat>
        聊天
        <mdui-badge v-if="unread > 0" slot="badge" variant="large">{{ unread > 99 ? '99+' : unread }}</mdui-badge>
      </mdui-navigation-bar-item>
    </mdui-navigation-bar>

    <mdui-layout-item ref="bottomItem" placement="bottom">
      <PlayerBar @open-player="showPlayer = true" @open-queue="showQueue = true" />
    </mdui-layout-item>

    <mdui-layout-main class="main">
      <div v-if="!room.connected" class="banner">正在重连…</div>
      <div v-if="room.needsUnlock" class="banner action" @click="room.setListening(true)">
        点这里开始在本机播放
      </div>
      <div class="content" :class="{ chat: tab === 'chat' }">
        <Transition name="fade-through" mode="out-in">
          <KeepAlive>
            <component :is="panes[tab]" :key="tab" />
          </KeepAlive>
        </Transition>
      </div>
    </mdui-layout-main>
  </mdui-layout>

  <NowPlayingSheet
    :open="showPlayer"
    :unread="unread"
    @close="showPlayer = false"
    @open-queue="showQueue = true"
    @open-chat="showChat = true"
  />
  <QueueSheet :open="showQueue" @close="showQueue = false" />
  <ChatSheet :open="showChat" @close="showChat = false" />
  <RoomInfoDialog :open="showRoomInfo" :code="code" @close="showRoomInfo = false" />
  <HostSettingsDialog v-if="room.isHost" :open="showSettings" @close="showSettings = false" />
  <MembersDialog :open="showMembers" @close="showMembers = false" />

  <mdui-dialog
    :open="!!room.hostQr"
    headline="成员绑定网易云"
    close-on-overlay-click
    @close.self="room.hostQr = null"
  >
    <div class="center stack" v-if="room.hostQr">
      <div class="muted">请 {{ room.hostQr.fromNickname }} 用自己手机上的网易云 App 扫描这个二维码</div>
      <img :src="room.hostQr.qrImage" width="220" height="220" alt="二维码" style="margin: 0 auto" />
    </div>
    <mdui-button slot="action" variant="text" @click="room.hostQr = null">关闭</mdui-button>
  </mdui-dialog>

  <mdui-dialog :open="!!room.closedReason" headline="提示">
    {{ room.closedReason }}
    <mdui-button slot="action" @click="backHome">回到首页</mdui-button>
  </mdui-dialog>
</template>

<style scoped>
/* 用 fixed + inset 而不是 vh/dvh：浏览器工具栏收起/出现、键盘弹出收起时，
   高度始终跟随当前可见区域，不会留下一块空白 */
.room-layout {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
}
.main {
  display: flex;
  flex-direction: column;
}
.content {
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
  padding: 12px 16px;
  box-sizing: border-box;
  flex: 1;
  overflow-y: auto;
}
.content.chat {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.listen {
  gap: 12px;
  width: 100%;
  min-width: 180px;
}
.banner {
  margin: 8px auto 0;
  max-width: 688px;
  width: calc(100% - 32px);
  box-sizing: border-box;
  border-radius: 14px;
  padding: 10px 16px;
  text-align: center;
  font-size: 0.875rem;
  font-weight: 500;
  background: rgb(var(--mdui-color-error-container));
  color: rgb(var(--mdui-color-on-error-container));
}
.banner.action {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
  cursor: pointer;
}
</style>
