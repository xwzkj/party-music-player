<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LyricsView from '../lyrics/LyricsView.vue'
import { usePrefs } from '../stores/prefs'
import { useRoom } from '../stores/room'
import { coverSrc, fmtTime, val } from '../ui'
import FullscreenSheet from './FullscreenSheet.vue'
import PlaybackButtons from './PlaybackButtons.vue'

/**
 * 播放页。两页切换："歌曲"是封面和信息，"歌词"是逐字歌词；进度和控制按钮两页共用。
 * 点封面进歌词、点歌词回封面，头部也有一个切换按钮。
 */
const props = defineProps<{ open: boolean; unread?: number }>()
const emit = defineEmits<{ close: []; openQueue: []; openChat: [] }>()
const room = useRoom()
const prefs = usePrefs()
const page = ref<'song' | 'lyrics'>('song')
const np = computed(() => room.snap?.nowPlaying ?? null)
const track = computed(() => np.value?.item.track ?? null)
const duration = computed(() => room.snap?.timeline.durationMs ?? 0)
const paused = computed(() => room.snap?.timeline.state === 'paused')

// 进度按帧更新，直接写 slider，不经过 Vue 的响应式，避免整页重渲染
const slider = ref<HTMLElement & { value: number } | null>(null)
const elapsedText = ref('0:00')
let seeking = false
let raf = 0

function frame(): void {
  const ms = room.positionMs()
  if (!seeking && slider.value) slider.value.value = ms / 1000
  const text = fmtTime(seeking && slider.value ? slider.value.value * 1000 : ms)
  if (text !== elapsedText.value) elapsedText.value = text
  raf = requestAnimationFrame(frame)
}

watch(
  () => props.open,
  (open) => {
    cancelAnimationFrame(raf)
    if (open) {
      page.value = 'song'
      raf = requestAnimationFrame(frame)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelAnimationFrame(raf))

function onSeekInput(): void {
  seeking = true
}
async function onSeekChange(e: Event): Promise<void> {
  const ms = Number(val(e)) * 1000
  seeking = false
  await room.act('host:playback', { action: 'seek', positionMs: ms })
}
function togglePage(): void {
  page.value = page.value === 'song' ? 'lyrics' : 'song'
}
</script>

<template>
  <FullscreenSheet :open="open" label="正在播放" tone="player" @close="emit('close')">
    <template #header>
      <div class="row header">
        <mdui-button-icon title="收起" @click="emit('close')">
          <mdui-icon-keyboard-arrow-down></mdui-icon-keyboard-arrow-down>
        </mdui-button-icon>
        <span class="spacer"></span>
        <mdui-button-icon :title="page === 'song' ? '看歌词' : '看封面'" @click="togglePage">
          <mdui-icon-lyrics v-if="page === 'song'"></mdui-icon-lyrics>
          <mdui-icon-music-note v-else></mdui-icon-music-note>
        </mdui-button-icon>
        <mdui-button-icon
          v-if="page === 'lyrics'"
          :selected="prefs.showTranslation"
          selectable
          title="显示翻译"
          @change="prefs.showTranslation = !prefs.showTranslation"
        >
          <mdui-icon-translate></mdui-icon-translate>
        </mdui-button-icon>
      </div>
    </template>

    <div v-if="track" class="np">
      <div class="pages">
        <Transition name="fade-through" mode="out-in">
          <div v-if="page === 'song'" key="song" class="song" @click="page = 'lyrics'">
            <img v-if="track.coverUrl" class="cover art" :src="coverSrc(track.coverUrl, 600)" alt="" />
            <div v-else class="cover art placeholder"><mdui-icon-music-note></mdui-icon-music-note></div>
          </div>
          <div v-else key="lyrics" class="lyrics">
            <LyricsView :source-id="track.sourceId" :duration-ms="track.durationMs" :show-translation="prefs.showTranslation" />
          </div>
        </Transition>
      </div>

      <div class="meta">
        <div class="headline-small ellipsis">{{ track.title }}</div>
        <div class="muted ellipsis">
          {{ track.artists.join(' / ') }}<template v-if="track.album"> · {{ track.album }}</template>
        </div>
        <div v-if="np?.item.addedBy.length" class="muted ellipsis">
          点歌：{{ np.item.addedBy.map((a) => a.nickname).join('、') }}
        </div>
      </div>

      <div class="controls">
        <mdui-slider
          ref="slider"
          :max="Math.max(1, duration / 1000)"
          step="0.01"
          :disabled="!room.isHost"
          nolabel
          @input="onSeekInput"
          @change="onSeekChange"
        ></mdui-slider>
        <div class="row times muted">
          <span>{{ elapsedText }}</span>
          <span class="spacer center">
            <template v-if="paused">
              {{ room.snap?.timeline.pausedBy === 'noListener' ? '没有设备出声，已暂停' : '已暂停' }}
            </template>
          </span>
          <span>{{ fmtTime(duration) }}</span>
        </div>
        <div class="transport">
          <mdui-button-icon title="播放列表" @click="emit('openQueue')">
            <mdui-icon-queue-music></mdui-icon-queue-music>
          </mdui-button-icon>
          <PlaybackButtons />
          <span class="chat-wrap">
            <mdui-button-icon :title="unread ? `聊天（${unread} 条新消息）` : '聊天'" @click="emit('openChat')">
              <mdui-icon-chat></mdui-icon-chat>
            </mdui-button-icon>
            <mdui-badge v-if="unread" class="chat-badge">{{ unread > 99 ? '99+' : unread }}</mdui-badge>
          </span>
        </div>
      </div>
    </div>
    <div v-else class="muted center empty">现在没有在播放</div>
  </FullscreenSheet>
</template>

<style scoped>
.header {
  max-width: 560px;
  margin: 0 auto;
  gap: 0;
}
.np {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 8px 24px 24px;
  box-sizing: border-box;
  gap: 16px;
}
.pages {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.song {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.art {
  width: min(100%, 100cqh, 480px);
  max-height: 100%;
  aspect-ratio: 1;
  border-radius: var(--mdui-shape-corner-extra-large);
  pointer-events: none;
}
.song {
  container-type: size;
}
.placeholder {
  display: grid;
  place-items: center;
  font-size: 72px;
  color: rgb(var(--mdui-color-on-surface-variant));
}
.lyrics {
  flex: 1;
  min-height: 0;
  min-width: 0;
  /* 用 flex 把歌词滚动框撑满，而不是靠子元素的 height: 100%：
     百分比高度在 flex 子项里不可靠，页面变矮后滚动框会停在旧高度并溢出 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.transport {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.chat-wrap {
  position: relative;
  display: inline-flex;
}
.chat-badge {
  position: absolute;
  top: 0;
  right: -2px;
  pointer-events: none;
}
.times {
  margin-top: -8px;
  padding: 0 4px;
}
.empty {
  padding: 64px 0;
}
/* 页面很矮时（横屏手机、弹出键盘）压缩信息区，把空间留给封面和歌词 */
@media (max-height: 520px) {
  .np {
    gap: 8px;
    padding-bottom: 12px;
  }
  .meta .muted:nth-child(3) {
    display: none;
  }
  .meta .headline-small {
    font-size: var(--mdui-typescale-title-large-size);
    line-height: var(--mdui-typescale-title-large-line-height);
  }
}
</style>
