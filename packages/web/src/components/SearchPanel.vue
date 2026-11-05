<script setup lang="ts">
import { ref } from 'vue'
import type { PlaylistSummary, Track } from '@pmp/shared'
import { get } from '../api/http'
import { coverSrc, toastError, val } from '../ui'
import PlaylistTracks from './PlaylistTracks.vue'
import TrackList from './TrackList.vue'

const type = ref<'track' | 'playlist'>('track')
const q = ref('')
const tracks = ref<Track[]>([])
const playlists = ref<PlaylistSummary[]>([])
const page = ref(1)
const loading = ref(false)
const searched = ref(false)
const openPlaylist = ref<PlaylistSummary | null>(null)

async function search(reset = true): Promise<void> {
  if (!q.value.trim()) return
  if (reset) {
    page.value = 1
    tracks.value = []
    playlists.value = []
  }
  loading.value = true
  try {
    const path = `/music/search?type=${type.value}&q=${encodeURIComponent(q.value.trim())}&page=${page.value}`
    if (type.value === 'track') tracks.value.push(...(await get<Track[]>(path)))
    else playlists.value.push(...(await get<PlaylistSummary[]>(path)))
    page.value++
    searched.value = true
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

function setType(v: 'track' | 'playlist'): void {
  if (type.value === v) return
  type.value = v
  if (q.value) void search()
}
</script>

<template>
  <PlaylistTracks v-if="openPlaylist" :playlist="openPlaylist" @back="openPlaylist = null" />
  <div v-else class="stack" style="gap: 8px">
    <mdui-text-field
      variant="outlined"
      placeholder="搜索歌曲、歌手或歌单"
      clearable
      :value="q"
      @input="q = val($event)"
      @keydown.enter="search()"
      enterkeyhint="search"
    >
      <mdui-button-icon slot="end-icon" @click="search()"><mdui-icon-search></mdui-icon-search></mdui-button-icon>
    </mdui-text-field>
    <div class="row">
      <mdui-chip variant="filter" :selected="type === 'track'" @click="setType('track')">歌曲</mdui-chip>
      <mdui-chip variant="filter" :selected="type === 'playlist'" @click="setType('playlist')">歌单</mdui-chip>
    </div>

    <TrackList v-if="type === 'track'" :tracks="tracks" />
    <mdui-list v-else>
      <mdui-list-item
        v-for="p in playlists"
        :key="p.id"
        :description="`${p.trackCount} 首 · ${p.creator}`"
        @click="openPlaylist = p"
      >
        <img v-if="p.coverUrl" slot="icon" class="cover" :src="coverSrc(p.coverUrl, 96)" width="40" height="40" alt="" />
        <span class="ellipsis">{{ p.name }}</span>
      </mdui-list-item>
    </mdui-list>

    <div class="center">
      <mdui-circular-progress v-if="loading"></mdui-circular-progress>
      <mdui-button v-else-if="searched && (tracks.length || playlists.length)" variant="text" @click="search(false)">
        加载更多
      </mdui-button>
      <span v-else-if="searched" class="muted">没有找到</span>
    </div>
  </div>
</template>
