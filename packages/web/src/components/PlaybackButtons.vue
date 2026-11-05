<script setup lang="ts">
import { computed } from 'vue'
import type { PlayVoteKind } from '@pmp/shared'
import { useRoom } from '../stores/room'

/** 房主直接执行；成员发起投票，按钮上显示实时进度 */
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const room = useRoom()
const s = computed(() => room.snap)
const np = computed(() => s.value?.nowPlaying ?? null)
const state = computed(() => s.value?.timeline.state ?? 'idle')
const playing = computed(() => state.value === 'playing')

function progress(kind: PlayVoteKind): string {
  const v = np.value?.votes[kind]
  if (!v || room.isHost || v.count === 0) return ''
  return `${v.count}/${v.needed}`
}

function mine(kind: PlayVoteKind): boolean {
  return !room.isHost && !!np.value?.votes[kind].mine
}

const toggleKind = computed<PlayVoteKind>(() => (playing.value ? 'pause' : 'resume'))

const canToggle = computed(() => {
  if (!np.value) return false
  if (room.isHost) return state.value !== 'idle'
  return np.value.votes[toggleKind.value].open
})
const canNext = computed(() => {
  if (room.isHost) return !!np.value || (s.value?.queue.length ?? 0) > 0
  return !!np.value?.votes.skip.open
})
const canPrev = computed(() => {
  if (!np.value || !s.value?.hasHistory) return false
  return room.isHost || np.value.votes.prev.open
})

async function toggle(): Promise<void> {
  if (room.isHost) await room.act('host:playback', { action: playing.value ? 'pause' : 'resume' })
  else await room.playVote(toggleKind.value)
}
async function next(): Promise<void> {
  if (room.isHost) await room.act('host:playback', { action: 'next' })
  else await room.playVote('skip')
}
async function prev(): Promise<void> {
  if (room.isHost) await room.act('host:playback', { action: 'prev' })
  else await room.playVote('prev')
}

const toggleTitle = computed(() => {
  if (room.isHost) return playing.value ? '暂停' : '继续'
  if (s.value?.timeline.pausedBy === 'noListener') return '没有设备出声，有设备出声就自动继续'
  return playing.value ? '投票暂停' : '投票继续'
})
</script>

<template>
  <div class="pb" :class="{ compact: props.compact }">
    <div v-if="!props.compact" class="btn">
      <mdui-button-icon :disabled="!canPrev" :variant="mine('prev') ? 'tonal' : 'standard'" title="上一曲" @click="prev">
        <mdui-icon-skip-previous></mdui-icon-skip-previous>
      </mdui-button-icon>
      <span class="count">{{ progress('prev') }}</span>
    </div>
    <div class="btn">
      <mdui-button-icon
        :disabled="!canToggle"
        :variant="mine(toggleKind) ? 'tonal' : props.compact ? 'standard' : 'filled'"
        :title="toggleTitle"
        @click="toggle"
      >
        <mdui-icon-pause v-if="playing"></mdui-icon-pause>
        <mdui-icon-play-arrow v-else></mdui-icon-play-arrow>
      </mdui-button-icon>
      <span class="count">{{ progress(toggleKind) }}</span>
    </div>
    <div class="btn">
      <mdui-button-icon :disabled="!canNext" :variant="mine('skip') ? 'tonal' : 'standard'" title="下一曲" @click="next">
        <mdui-icon-skip-next></mdui-icon-skip-next>
      </mdui-button-icon>
      <span class="count">{{ progress('skip') }}</span>
    </div>
  </div>
</template>

<style scoped>
.pb {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.pb.compact {
  gap: 0;
}
.btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 40px;
}
.count {
  font-size: 0.7rem;
  line-height: 1;
  min-height: 0.7rem;
  color: rgb(var(--mdui-color-primary));
}
.compact .count {
  min-height: 0;
}
</style>
