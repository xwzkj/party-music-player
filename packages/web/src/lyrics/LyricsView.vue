<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { findLyricIndex, parseLyrics, type LyricLine, type RawLyrics } from '@pmp/shared'
import { get } from '../api/http'
import { easing, tween } from '../motion'
import { useRoom } from '../stores/room'

/** 歌词按服务端时间轴计算进度，不依赖本机音频，不出声的设备也能同步滚动 */
const props = defineProps<{ sourceId: string; durationMs: number; showTranslation: boolean }>()
const room = useRoom()
const lines = ref<LyricLine[]>([])
const loading = ref(false)
const index = ref(-1)
const box = ref<HTMLDivElement | null>(null)
let raf = 0
let resizeObserver: ResizeObserver | null = null
let cancelScroll: (() => void) | null = null
/** 用户手动滚动后暂停自动跟随的时间点；滚动期间不断顺延 */
let pauseUntil = 0
/** 程序触发 scrollTop 后的一小段时间内，忽略由此产生的 scroll 事件 */
let programmaticUntil = 0
let words: { el: HTMLElement; startMs: number; durationMs: number }[] = []

function markProgrammatic(): void {
  programmaticUntil = performance.now() + 200
}

/** 用户开始滚动：停掉动画，并暂时不要跟随 */
function pauseFollow(): void {
  cancelScroll?.()
  pauseUntil = performance.now() + 6000
}

function onScroll(): void {
  if (performance.now() < programmaticUntil) return
  pauseUntil = performance.now() + 6000
  cancelScroll?.()
}

async function load(id: string): Promise<void> {
  loading.value = true
  lines.value = []
  index.value = -1
  try {
    const raw = await get<RawLyrics>(`/music/lyrics/${id}`)
    if (id === props.sourceId) lines.value = parseLyrics(raw, props.durationMs)
  } catch {
    lines.value = []
  } finally {
    loading.value = false
  }
  await nextTick()
  index.value = findLyricIndex(lines.value, room.positionMs())
  await nextTick()
  // 换歌后回到跟随状态
  pauseUntil = 0
  scrollToCurrent(false)
  collectWords()
}

/** 当前行的逐字进度直接写到 DOM，只有换行时才触发 Vue 更新 */
function frame(): void {
  const pos = room.positionMs()
  const i = findLyricIndex(lines.value, pos)
  if (i !== index.value) {
    index.value = i
    void nextTick(() => {
      collectWords()
      scrollToCurrent(true)
    })
  }
  for (const w of words) {
    const p = w.durationMs > 0 ? (pos - w.startMs) / w.durationMs : pos >= w.startMs ? 1 : 0
    w.el.style.setProperty('--p', `${(Math.max(0, Math.min(1, p)) * 100).toFixed(1)}%`)
  }
  raf = requestAnimationFrame(frame)
}

function collectWords(): void {
  const line = lines.value[index.value]
  const els = box.value?.querySelectorAll<HTMLElement>(`[data-i="${index.value}"] .word`)
  words = line?.words && els ? line.words.map((w, j) => ({ el: els[j], startMs: w.startMs, durationMs: w.durationMs })) : []
}

/** 把当前行滚到中间；动画用 MD3 emphasized 曲线。用户手动滚动后不再自动跟随 */
function scrollToCurrent(animate: boolean): void {
  const b = box.value
  const el = b?.querySelector<HTMLElement>(`[data-i="${index.value}"]`)
  if (!b || !el || performance.now() < pauseUntil) return
  // 容器是 offsetParent（见样式里的 position: relative），offsetTop 不受外层缩放动画影响
  const target = el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2
  cancelScroll?.()
  if (!animate) {
    markProgrammatic()
    b.scrollTop = target
    return
  }
  const from = b.scrollTop
  const stop = tween(500, easing.emphasized, (p) => {
    markProgrammatic()
    b.scrollTop = from + (target - from) * p
  })
  cancelScroll = () => {
    stop()
    cancelScroll = null
  }
}

watch(
  () => props.sourceId,
  (id) => void load(id),
)
watch(
  () => props.showTranslation,
  () => void nextTick(() => scrollToCurrent(true)),
)
/**
 * 上下留白取容器高度的一半，任何一行（包括第一行和最后一行）都能滚到正中。
 * 留白放在滚动内容里的占位元素上，不能用容器的 padding：padding 会计入容器的最小高度，
 * 而它又取自容器高度，页面变矮后容器就缩不回去，歌词溢出到下面的内容上。
 */
function syncPadding(): void {
  const b = box.value
  if (b) b.style.setProperty('--pad', `${Math.round(b.clientHeight / 2)}px`)
}

onMounted(() => {
  syncPadding()
  void load(props.sourceId)
  raf = requestAnimationFrame(frame)
  if (box.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      syncPadding()
      scrollToCurrent(false)
    })
    resizeObserver.observe(box.value)
  }
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(raf)
  cancelScroll?.()
})
</script>

<template>
  <div class="wrap">
    <div
      ref="box"
      class="lyrics"
      @scroll.passive="onScroll"
      @wheel.passive="pauseFollow"
      @touchstart.passive="pauseFollow"
    >
      <div class="spacer-pad" aria-hidden="true"></div>
      <div v-if="loading" class="muted center">歌词加载中…</div>
      <div v-else-if="!lines.length" class="muted center">暂无歌词</div>
      <div v-for="(l, i) in lines" :key="i" :data-i="i" class="line" :class="{ current: i === index }">
        <div v-if="i === index && l.words" class="text">
          <span v-for="(w, j) in l.words" :key="j" class="word">{{ w.text }}</span>
        </div>
        <div v-else class="text">{{ l.text }}</div>
        <div v-if="showTranslation && l.translation" class="tr">{{ l.translation }}</div>
      </div>
      <div class="spacer-pad" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  /* 遮罩放在外层：部分浏览器（尤其 iOS Safari）给滚动容器加 mask 会吃掉滚动 */
  mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
  -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
}
.lyrics {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 0 8px;
  box-sizing: border-box;
  text-align: center;
  /* 明确允许纵向手势，避免被外层手势或合成层吞掉 */
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.spacer-pad {
  height: var(--pad, 40%);
}
.line {
  padding: 10px 0;
  color: rgb(var(--mdui-color-on-surface-variant));
  opacity: 0.55;
  transform-origin: center;
  transition:
    opacity var(--mdui-motion-duration-long2) var(--app-easing-emphasized),
    transform var(--mdui-motion-duration-long2) var(--app-easing-emphasized),
    color var(--mdui-motion-duration-long2) var(--app-easing-emphasized);
}
.line.current {
  opacity: 1;
  color: rgb(var(--mdui-color-on-surface));
  transform: scale(1.06);
}
.text {
  font-size: var(--mdui-typescale-title-large-size);
  line-height: var(--mdui-typescale-title-large-line-height);
  font-weight: 500;
}
.tr {
  font-size: var(--mdui-typescale-body-medium-size);
  margin-top: 2px;
}
.word {
  --p: 0%;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    rgb(var(--mdui-color-primary)) var(--p),
    rgb(var(--mdui-color-on-surface-variant)) var(--p)
  );
  -webkit-background-clip: text;
  background-clip: text;
}
</style>
