<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LyricsView from '../lyrics/LyricsView.vue'
import { usePrefs } from '../stores/prefs'
import { useRoom } from '../stores/room'
import { coverSrc, fmtTime, val } from '../ui'
import FullscreenSheet from './FullscreenSheet.vue'
import PlaybackButtons from './PlaybackButtons.vue'

/** 播放页：两页切换，"歌曲"是封面和信息，"歌词"是逐字歌词；进度和控制按钮两页共用 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
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
    if (open) raf = requestAnimationFrame(frame)
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
function onVolume(e: Event): void {
  room.setVolume(Number(val(e)) / 100)
}
function onTab(e: Event): void {
  const v = val(e)
  if (v === 'song' || v === 'lyrics') page.value = v
}
</script>

<template>
  <FullscreenSheet :open="open" label="正在播放" @close="emit('close')">
    <template #header>
      <div class="row header">
        <mdui-button-icon title="收起" @click="emit('close')">
          <mdui-icon-keyboard-arrow-down></mdui-icon-keyboard-arrow-down>
        </mdui-button-icon>
        <mdui-tabs class="tabs" :value="page" @change="onTab">
          <mdui-tab value="song">歌曲</mdui-tab>
          <mdui-tab value="lyrics">歌词</mdui-tab>
        </mdui-tabs>
        <mdui-button-icon
          :style="{ visibility: page === 'lyrics' ? 'visible' : 'hidden' }"
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
        <PlaybackButtons />
        <div class="row volume">
          <mdui-icon-volume-up></mdui-icon-volume-up>
          <mdui-slider class="spacer" :value="Math.round(prefs.volume * 100)" max="100" nolabel @input="onVolume"></mdui-slider>
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
.tabs {
  flex: 1;
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
.times {
  margin-top: -8px;
  padding: 0 4px;
}
.volume {
  padding: 0 4px;
  color: rgb(var(--mdui-color-on-surface-variant));
}
.empty {
  padding: 64px 0;
}
</style>
