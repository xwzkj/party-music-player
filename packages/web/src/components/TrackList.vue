<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Track } from '@pmp/shared'
import { useRoom } from '../stores/room'
import { ask, coverSrc, fmtTime, toast } from '../ui'

defineProps<{ tracks: Track[] }>()
const room = useRoom()
const adding = ref<string | null>(null)

const queued = computed(() => {
  const m = new Map<string, boolean>()
  for (const q of room.snap?.queue ?? []) m.set(q.track.sourceId, q.mine)
  const up = room.snap?.upNext
  if (up) m.set(up.track.sourceId, up.mine)
  return m
})
const playingId = computed(() => room.snap?.nowPlaying?.item.track.sourceId)

async function add(t: Track): Promise<void> {
  const me = room.snap?.me
  if (!me) return
  if (queued.value.get(t.sourceId)) return toast('你已经点过这首歌了')
  // 设了配额时弹确认框，显示剩余配额
  if (me.quotaLimit !== null) {
    const left = me.quotaLimit - me.quotaUsed
    if (left <= 0) return toast('点歌名额已用完')
    if (!(await ask(`还能点 ${left} 首，确定添加？`, `${t.title} - ${t.artists.join(' / ')}`))) return
  }
  const existed = queued.value.has(t.sourceId)
  adding.value = t.sourceId
  const r = await room.act<{ itemId: string }>('queue:add', { sourceId: t.sourceId })
  adding.value = null
  if (r) toast(existed ? '已加入，和别人点的合并计数' : '已加入队列')
}
</script>

<template>
  <mdui-list>
    <mdui-list-item v-for="t in tracks" :key="t.sourceId" nonclickable>
      <img
        v-if="t.coverUrl"
        slot="icon"
        class="cover"
        :src="coverSrc(t.coverUrl, 96)"
        width="40"
        height="40"
        loading="lazy"
        alt=""
      />
      <span class="ellipsis">{{ t.title }}</span>
      <span slot="description" class="ellipsis">{{ t.artists.join(' / ') }} · {{ t.album }} · {{ fmtTime(t.durationMs) }}</span>
      <div slot="end-icon">
        <span v-if="playingId === t.sourceId" class="muted">播放中</span>
        <span v-else-if="queued.get(t.sourceId)" class="muted">已点</span>
        <mdui-button-icon v-else :loading="adding === t.sourceId" @click="add(t)" title="点歌">
          <mdui-icon-add></mdui-icon-add>
        </mdui-button-icon>
      </div>
    </mdui-list-item>
  </mdui-list>
</template>
