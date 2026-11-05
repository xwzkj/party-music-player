<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChatPanel from '../components/ChatPanel.vue'
import HostSettingsDialog from '../components/HostSettingsDialog.vue'
import MembersDialog from '../components/MembersDialog.vue'
import NowPlayingSheet from '../components/NowPlayingSheet.vue'
import PlayerBar from '../components/PlayerBar.vue'
import PlaylistsPanel from '../components/PlaylistsPanel.vue'
import QueueSheet from '../components/QueueSheet.vue'
import RoomInfoDialog from '../components/RoomInfoDialog.vue'
import SearchPanel from '../components/SearchPanel.vue'
import { useRoom } from '../stores/room'
import { applyCoverColor } from '../theme'
import { ask, checked, copyText, toast, val } from '../ui'

const props = defineProps<{ code: string }>()
const router = useRouter()
const room = useRoom()
const tab = ref<'search' | 'playlists' | 'chat'>('search')
const showPlayer = ref(false)
const showQueue = ref(false)
const showSettings = ref(false)
const showMembers = ref(false)
const showRoomInfo = ref(false)
let decided = false

const s = computed(() => room.snap)
const panes = { search: SearchPanel, playlists: PlaylistsPanel, chat: ChatPanel }

onMounted(() => void room.open(props.code))
onBeforeUnmount(() => {
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
  if (await copyText(text)) toast('邀请链接已复制')
  else toast(text)
}

// 播放页里的入口：先收起播放页，再打开目标
function openQueueFromPlayer(): void {
  showPlayer.value = false
  showQueue.value = true
}

function openChatFromPlayer(): void {
  showPlayer.value = false
  tab.value = 'chat'
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
          <mdui-menu-item v-else @click="leaveRoom">离开房间</mdui-menu-item>
        </mdui-menu>
      </mdui-dropdown>
    </mdui-top-app-bar>

    <mdui-navigation-bar :value="tab" @change="setTab" label-visibility="labeled">
      <mdui-navigation-bar-item value="search"><mdui-icon-search slot="icon"></mdui-icon-search>搜索</mdui-navigation-bar-item>
      <mdui-navigation-bar-item value="playlists">
        <mdui-icon-library-music slot="icon"></mdui-icon-library-music>我的歌单
      </mdui-navigation-bar-item>
      <mdui-navigation-bar-item value="chat"><mdui-icon-chat slot="icon"></mdui-icon-chat>聊天</mdui-navigation-bar-item>
    </mdui-navigation-bar>

    <mdui-layout-item placement="bottom">
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
    @close="showPlayer = false"
    @open-queue="openQueueFromPlayer"
    @open-chat="openChatFromPlayer"
  />
  <QueueSheet :open="showQueue" @close="showQueue = false" />
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
.room-layout {
  height: 100vh;
  height: 100dvh;
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
