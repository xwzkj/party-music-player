<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PlaylistSummary } from '@pmp/shared'
import { get, post } from '../api/http'
import { useRoom } from '../stores/room'
import { coverSrc, toastError, val } from '../ui'
import NeteaseBind from './NeteaseBind.vue'
import PlaylistTracks from './PlaylistTracks.vue'

const room = useRoom()
const playlists = ref<PlaylistSummary[]>([])
const loading = ref(false)
const link = ref('')
const openPlaylist = ref<Pick<PlaylistSummary, 'id' | 'name'> | null>(null)

async function load(): Promise<void> {
  if (!room.snap?.me.neteaseBound) {
    playlists.value = []
    return
  }
  loading.value = true
  try {
    playlists.value = await get<PlaylistSummary[]>('/netease/me/playlists')
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

async function resolveLink(): Promise<void> {
  try {
    const r = await post<{ id: string }>('/music/playlist/resolve', { link: link.value })
    openPlaylist.value = { id: r.id, name: '分享的歌单' }
  } catch (e) {
    toastError(e)
  }
}

onMounted(load)
watch(() => room.snap?.me.neteaseBound, load)
</script>

<template>
  <PlaylistTracks v-if="openPlaylist" :playlist="openPlaylist" @back="openPlaylist = null" />
  <div v-else class="stack" style="gap: 8px">
    <div class="row">
      <mdui-text-field class="spacer" label="粘贴歌单分享链接" :value="link" @input="link = val($event)" @keydown.enter="resolveLink">
        <mdui-icon-link slot="icon"></mdui-icon-link>
      </mdui-text-field>
      <mdui-button variant="tonal" @click="resolveLink">打开</mdui-button>
    </div>

    <template v-if="room.snap?.me.neteaseBound">
      <div style="font-weight: 500">我的歌单</div>
      <mdui-circular-progress v-if="loading"></mdui-circular-progress>
      <mdui-list>
        <mdui-list-item
          v-for="p in playlists"
          :key="p.id"
          :description="`${p.trackCount} 首`"
          @click="openPlaylist = p"
        >
          <img v-if="p.coverUrl" slot="icon" class="cover" :src="coverSrc(p.coverUrl, 96)" width="40" height="40" alt="" />
          {{ p.name }}
        </mdui-list-item>
      </mdui-list>
    </template>
    <template v-else>
      <div style="font-weight: 500">绑定网易云账号，从自己的收藏点歌</div>
      <NeteaseBind :show-on-host="room.isHost ? undefined : room.code ?? undefined" />
    </template>
  </div>
</template>
