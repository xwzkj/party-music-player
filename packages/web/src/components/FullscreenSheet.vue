<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 全屏底部面板（mdui 没有 bottom sheet）。
 * 动效按 MD3：进入从底部上滑，emphasized-decelerate 500ms；退出下滑，emphasized-accelerate 200ms。
 * 顶部拖动条可以下拉关闭。
 */
const props = defineProps<{ open: boolean; label: string }>()
const emit = defineEmits<{ close: [] }>()

const sheet = ref<HTMLElement | null>(null)
const dragY = ref(0)
const dragging = ref(false)
const settling = ref(false)
let startY = 0
let startX = 0
let startT = 0
let pointerId: number | null = null
let restoreFocus: HTMLElement | null = null

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKey)
      await nextTick()
      sheet.value?.focus({ preventScroll: true })
    } else {
      document.removeEventListener('keydown', onKey)
      restoreFocus?.focus?.({ preventScroll: true })
    }
  },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  pointerId = e.pointerId
  startY = e.clientY
  startX = e.clientX
  startT = performance.now()
}

function onMove(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return
  const dy = e.clientY - startY
  if (!dragging.value) {
    // 明确是向下拖动才开始，避免挡住顶栏按钮的点击
    if (dy < 8 || Math.abs(dy) < Math.abs(e.clientX - startX)) return
    dragging.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  dragY.value = Math.max(0, dy)
}

function onUp(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return
  pointerId = null
  if (!dragging.value) return
  dragging.value = false
  const h = sheet.value?.clientHeight ?? window.innerHeight
  const velocity = dragY.value / Math.max(1, performance.now() - startT) // px/ms
  if (dragY.value > h * 0.25 || velocity > 0.6) {
    // 从当前位置继续退出动画；dragY 在 after-leave 里清零
    emit('close')
    return
  }
  settling.value = true
  dragY.value = 0
}

function onSettled(e: TransitionEvent): void {
  if (e.target === sheet.value && e.propertyName === 'transform') settling.value = false
}

function afterLeave(): void {
  dragY.value = 0
  settling.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet" @after-leave="afterLeave">
      <section
        v-if="open"
        ref="sheet"
        class="sheet"
        :class="{ settling, dragging }"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        data-app-sheet
        tabindex="-1"
        :style="dragY ? { transform: `translateY(${dragY}px)` } : undefined"
        @transitionend="onSettled"
      >
        <div
          class="grab"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="handle" aria-hidden="true"></div>
          <slot name="header" />
        </div>
        <div class="body"><slot /></div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 2050;
  display: flex;
  flex-direction: column;
  background: rgb(var(--mdui-color-surface));
  color: rgb(var(--mdui-color-on-surface));
  outline: none;
  will-change: transform;
}
.grab {
  flex-shrink: 0;
  touch-action: none;
  padding: 0 8px;
}
.handle {
  width: 32px;
  height: 4px;
  margin: 16px auto 4px;
  border-radius: 2px;
  background: rgb(var(--mdui-color-on-surface-variant));
  opacity: 0.4;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sheet.dragging {
  transition: none;
}
.sheet.settling {
  transition: transform var(--mdui-motion-duration-medium2) var(--mdui-motion-easing-standard-decelerate);
}

.sheet-enter-active {
  transition: transform var(--mdui-motion-duration-long2) var(--app-easing-emphasized-decelerate);
}
.sheet-leave-active {
  transition: transform var(--mdui-motion-duration-short4) var(--app-easing-emphasized-accelerate);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%) !important;
}
</style>
