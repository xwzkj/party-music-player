<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoom } from '../stores/room'
import { coverSrc } from '../ui'
import PlaybackButtons from './PlaybackButtons.vue'

const emit = defineEmits<{ openPlayer: []; openQueue: [] }>()
const room = useRoom()
const s = computed(() => room.snap)
const track = computed(() => s.value?.nowPlaying?.item ?? null)
// 进度按帧写 transform，不用 CSS 过渡（换歌时会从 100% 倒着滑回 0）
const line = ref<HTMLElement | null>(null)
let raf = 0

function frame(): void {
  const d = s.value?.timeline.durationMs ?? 0
  const p = d > 0 ? Math.min(1, room.positionMs() / d) : 0
  if (line.value) line.value.style.transform = `scaleX(${p})`
  raf = requestAnimationFrame(frame)
}
onMounted(() => (raf = requestAnimationFrame(frame)))
onBeforeUnmount(() => cancelAnimationFrame(raf))

const idleHint = computed(() => {
  const q = s.value?.queue.length ?? 0
  if (!q) return '还没有歌，去搜索点一首吧'
  const anyListening = s.value?.members.some((m) => m.listening)
  if (!anyListening) return `队列里有 ${q} 首，打开"本机出声"就开始播放`
  return `队列里有 ${q} 首`
})
</script>

<template>
  <div class="dock">
    <div class="bar">
      <div class="row inner">
        <Transition name="fade-through" mode="out-in">
          <div :key="track?.id ?? 'idle'" class="row left" @click="emit('openPlayer')">
            <img v-if="track?.track.coverUrl" class="cover" :src="coverSrc(track.track.coverUrl, 120)" width="48" height="48" alt="" />
            <div v-else class="cover placeholder"><mdui-icon-music-note></mdui-icon-music-note></div>
            <div class="text">
              <template v-if="track">
                <div class="title-medium ellipsis">{{ track.track.title }}</div>
                <div class="muted ellipsis">{{ track.track.artists.join(' / ') }}</div>
              </template>
              <div v-else class="muted ellipsis">{{ idleHint }}</div>
            </div>
          </div>
        </Transition>
        <PlaybackButtons compact />
        <mdui-button-icon title="播放列表" @click="emit('openQueue')">
          <mdui-icon-queue-music></mdui-icon-queue-music>
        </mdui-button-icon>
      </div>
      <div class="track"><div ref="line" class="line"></div></div>
    </div>
  </div>
</template>

<style scoped>
.dock {
  flex: 1;
  min-width: 0;
  padding: 0 12px 8px;
}
.bar {
  max-width: 720px;
  margin: 0 auto;
  border-radius: var(--mdui-shape-corner-large);
  overflow: hidden;
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}
.bar .muted {
  color: rgb(var(--mdui-color-on-secondary-container));
}
.inner {
  padding: 8px 8px 6px;
}
.left {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  gap: 12px;
}
.placeholder {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: rgb(var(--mdui-color-on-surface-variant));
}
.text {
  min-width: 0;
  flex: 1;
}
.track {
  height: 4px;
  margin: 0 16px 10px;
  border-radius: 2px;
  background: rgba(var(--mdui-color-on-secondary-container), 0.16);
  overflow: hidden;
}
.line {
  height: 100%;
  border-radius: 2px;
  background: rgb(var(--mdui-color-primary));
  transform-origin: left center;
  transform: scaleX(0);
}
</style>
