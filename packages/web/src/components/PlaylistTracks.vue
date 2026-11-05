<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PlaylistSummary, Track } from '@pmp/shared'
import { get } from '../api/http'
import { toastError } from '../ui'
import TrackList from './TrackList.vue'

const props = defineProps<{ playlist: Pick<PlaylistSummary, 'id' | 'name'> }>()
const emit = defineEmits<{ back: [] }>()
const tracks = ref<Track[]>([])
const page = ref(1)
const loading = ref(false)
const done = ref(false)

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
</script>

<template>
  <div>
    <div class="row">
      <mdui-button-icon @click="emit('back')"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
      <div class="ellipsis spacer" style="font-weight: 500">{{ playlist.name }}</div>
    </div>
    <TrackList :tracks="tracks" />
    <div class="center" style="padding: 8px">
      <mdui-circular-progress v-if="loading"></mdui-circular-progress>
      <mdui-button v-else-if="!done" variant="text" @click="more">加载更多</mdui-button>
      <span v-else-if="!tracks.length" class="muted">歌单是空的</span>
    </div>
  </div>
</template>
