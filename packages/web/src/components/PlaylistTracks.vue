<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlaylistSummary, Track } from '@pmp/shared'
import { get } from '../api/http'
import { useRoom } from '../stores/room'
import { toast, toastError } from '../ui'
import TrackList from './TrackList.vue'

const props = defineProps<{ playlist: Pick<PlaylistSummary, 'id' | 'name'> }>()
const emit = defineEmits<{ back: [] }>()
const room = useRoom()
const tracks = ref<Track[]>([])
const page = ref(1)
const loading = ref(false)
const done = ref(false)
const settingFallback = ref(false)

/** 这个歌单是不是房间当前的兜底歌单 */
const isFallback = computed(() => room.snap?.room.settings.fallbackPlaylistId === props.playlist.id)

async function more(): Promise<void> {
  loading.value = true
  try {
    const r = await get<Track[]>(`/music/playlists/${props.playlist.id}/tracks?page=${page.value}`)
    tracks.value.push(...r)
    page.value++
    if (r.length < 50) done.value = true
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}
onMounted(more)

/** 只改兜底歌单这一项；host:settings 接受部分更新 */
async function toggleFallback(): Promise<void> {
  const next = isFallback.value ? null : props.playlist.id
  settingFallback.value = true
  const ok = await room.act('host:settings', { fallbackPlaylistId: next })
  settingFallback.value = false
  if (ok !== undefined) toast(next ? '已设为兜底歌单，队列空了会从这里随机播放' : '已取消兜底歌单')
}
</script>

<template>
  <div>
    <div class="row head">
      <mdui-button-icon title="返回" @click="emit('back')"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
      <div class="ellipsis spacer" style="font-weight: 500">{{ playlist.name }}</div>
    </div>
    <div v-if="room.isHost" class="fallback" :class="{ on: isFallback }">
      <div class="spacer">
        <div class="fallback-title">{{ isFallback ? '当前兜底歌单' : '兜底歌单' }}</div>
        <div class="muted">队列空了就从这个歌单里随机播放</div>
      </div>
      <mdui-button :variant="isFallback ? 'text' : 'tonal'" :loading="settingFallback" @click="toggleFallback">
        {{ isFallback ? '取消' : '设为兜底' }}
      </mdui-button>
    </div>
    <TrackList :tracks="tracks" />
    <div class="center" style="padding: 8px">
      <mdui-circular-progress v-if="loading"></mdui-circular-progress>
      <mdui-button v-else-if="!done" variant="text" @click="more">加载更多</mdui-button>
      <span v-else-if="!tracks.length" class="muted">歌单是空的</span>
    </div>
  </div>
</template>

<style scoped>
.fallback {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 4px 0 8px;
  padding: 10px 12px 10px 16px;
  border-radius: var(--mdui-shape-corner-large);
  background: rgb(var(--mdui-color-surface-container-low));
}
.fallback.on {
  background: rgb(var(--mdui-color-secondary-container));
  color: rgb(var(--mdui-color-on-secondary-container));
}
.fallback.on .muted {
  color: inherit;
  opacity: 0.8;
}
.fallback-title {
  font-weight: 500;
}
</style>
