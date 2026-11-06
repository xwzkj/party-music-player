<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ArtistSummary, Track } from '@pmp/shared'
import { get } from '../api/http'
import { toastError } from '../ui'
import TrackList from './TrackList.vue'

/** 歌手的热门歌曲 */
const props = defineProps<{ artist: Pick<ArtistSummary, 'id' | 'name'> }>()
const emit = defineEmits<{ back: [] }>()
const tracks = ref<Track[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    tracks.value = await get<Track[]>(`/music/artists/${props.artist.id}/tracks`)
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <div class="row">
      <mdui-button-icon title="返回" @click="emit('back')"><mdui-icon-arrow-back></mdui-icon-arrow-back></mdui-button-icon>
      <div class="ellipsis spacer" style="font-weight: 500">{{ artist.name }} · 热门歌曲</div>
    </div>
    <TrackList :tracks="tracks" />
    <div class="center" style="padding: 8px">
      <mdui-circular-progress v-if="loading"></mdui-circular-progress>
      <span v-else-if="!tracks.length" class="muted">没有找到歌曲</span>
    </div>
  </div>
</template>
