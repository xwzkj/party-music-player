<script setup lang="ts">
import { computed } from 'vue'
import { useRoom } from '../stores/room'
import { coverSrc, fmtTime } from '../ui'
import FullscreenSheet from './FullscreenSheet.vue'
import QueueItemCard from './QueueItemCard.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const s = computed(() => room.snap)
const reasonText = { finished: '', skipped: '已切歌', removed: '已移除', error: '播放失败' } as const
</script>

<template>
  <FullscreenSheet :open="open" label="播放列表" @close="emit('close')">
    <template #header>
      <div class="row header">
        <mdui-button-icon title="收起" @click="emit('close')">
          <mdui-icon-keyboard-arrow-down></mdui-icon-keyboard-arrow-down>
        </mdui-button-icon>
        <div class="title-large spacer">播放列表</div>
        <span class="muted quota" v-if="s?.me.quotaLimit != null">已点 {{ s.me.quotaUsed }}/{{ s.me.quotaLimit }}</span>
      </div>
    </template>

    <div class="wrap">
      <div class="muted">按投票、点歌人次、等待时间、热门度和时长加权排序。点歌曲可以查看得分构成。</div>

      <template v-if="s?.nowPlaying">
        <div class="title-medium">正在播放</div>
        <div class="played now">
          <img v-if="s.nowPlaying.item.track.coverUrl" class="cover" :src="coverSrc(s.nowPlaying.item.track.coverUrl, 96)" width="40" height="40" alt="" />
          <div class="info">
            <div class="ellipsis">{{ s.nowPlaying.item.track.title }}</div>
            <div class="muted ellipsis">{{ s.nowPlaying.item.track.artists.join(' / ') }}</div>
          </div>
        </div>
      </template>

      <template v-if="s?.upNext">
        <div class="title-medium">下一首（已锁定）</div>
        <QueueItemCard :item="s.upNext" locked />
      </template>

      <div class="title-medium">待播（{{ s?.queue.length ?? 0 }}）</div>
      <div v-if="!s?.queue.length" class="muted">队列是空的</div>
      <TransitionGroup name="queue" tag="div" class="list">
        <QueueItemCard v-for="(item, i) in s?.queue ?? []" :key="item.id" :item="item" :rank="i + 1" />
      </TransitionGroup>

      <template v-if="s?.history.length">
        <div class="title-medium">已播放（{{ s.history.length }}）</div>
        <div class="list">
          <div v-for="h in s.history" :key="h.id" class="played">
            <img v-if="h.track.coverUrl" class="cover" :src="coverSrc(h.track.coverUrl, 96)" width="40" height="40" alt="" />
            <div class="info">
              <div class="ellipsis">{{ h.track.title }}</div>
              <div class="muted ellipsis">
                {{ h.track.artists.join(' / ') }} · {{ fmtTime(h.track.durationMs) }} ·
                {{ h.addedBy.length ? h.addedBy.map((a) => a.nickname).join('、') : '兜底歌单' }}
                <template v-if="reasonText[h.reason]"> · {{ reasonText[h.reason] }}</template>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </FullscreenSheet>
</template>

<style scoped>
.header {
  max-width: 640px;
  margin: 0 auto;
  gap: 0;
}
.quota {
  padding-right: 16px;
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
.played {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-low));
}
.played:not(.now) {
  opacity: 0.7;
}
.played.now {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}
.played.now .muted {
  color: inherit;
}
.played .info {
  flex: 1;
  min-width: 0;
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
