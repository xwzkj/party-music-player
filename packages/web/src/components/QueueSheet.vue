<script setup lang="ts">
import { computed } from 'vue'
import { useRoom } from '../stores/room'
import FullscreenSheet from './FullscreenSheet.vue'
import QueueItemCard from './QueueItemCard.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const s = computed(() => room.snap)
</script>

<template>
  <FullscreenSheet :open="open" label="播放列表" @close="emit('close')">
    <template #header>
      <div class="row header">
        <div class="title-large spacer">播放列表</div>
        <span class="muted" v-if="s?.me.quotaLimit != null">已点 {{ s.me.quotaUsed }}/{{ s.me.quotaLimit }}</span>
        <mdui-button-icon title="关闭" @click="emit('close')"><mdui-icon-close></mdui-icon-close></mdui-button-icon>
      </div>
    </template>

    <div class="wrap">
      <div class="muted">按投票、点歌人次、等待时间、热门度和时长加权排序。点歌曲可以查看得分构成。</div>

      <template v-if="s?.upNext">
        <div class="title-medium">下一首（已锁定）</div>
        <QueueItemCard :item="s.upNext" locked />
      </template>

      <div class="title-medium">待播（{{ s?.queue.length ?? 0 }}）</div>
      <div v-if="!s?.queue.length" class="muted">队列是空的</div>
      <TransitionGroup name="queue" tag="div" class="list">
        <QueueItemCard v-for="(item, i) in s?.queue ?? []" :key="item.id" :item="item" :rank="i + 1" />
      </TransitionGroup>
    </div>
  </FullscreenSheet>
</template>

<style scoped>
.header {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 8px 0 16px;
}
.wrap {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 8px 16px 24px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 重排：位移用 emphasized；新加入的淡入并轻微放大；移除的只淡出 */
.queue-move {
  transition: transform var(--mdui-motion-duration-long2) var(--app-easing-emphasized);
}
.queue-enter-active {
  transition:
    opacity var(--mdui-motion-duration-medium2) var(--app-easing-emphasized-decelerate),
    transform var(--mdui-motion-duration-medium2) var(--app-easing-emphasized-decelerate);
}
.queue-leave-active {
  transition: opacity var(--mdui-motion-duration-short3) var(--app-easing-emphasized-accelerate);
}
.queue-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.queue-leave-to {
  opacity: 0;
}
</style>
