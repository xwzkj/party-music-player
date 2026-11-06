<script setup lang="ts">
import { ref } from 'vue'
import type { ArtistSummary, PlaylistSummary, Track } from '@pmp/shared'
import { get } from '../api/http'
import { usePrefs } from '../stores/prefs'
import { useRoom } from '../stores/room'
import { coverSrc, toastError, val } from '../ui'
import ArtistTracks from './ArtistTracks.vue'
import PlaylistTracks from './PlaylistTracks.vue'
import TrackList from './TrackList.vue'

type SearchType = 'track' | 'artist' | 'playlist'

const prefs = usePrefs()
const room = useRoom()
const type = ref<SearchType>('track')
const q = ref('')
const tracks = ref<Track[]>([])
const artists = ref<ArtistSummary[]>([])
const playlists = ref<PlaylistSummary[]>([])
const page = ref(1)
const loading = ref(false)
const searched = ref(false)
/** 最后一页返回的条数少于这个数时，说明没有更多了 */
const done = ref(false)
const openPlaylist = ref<PlaylistSummary | null>(null)
const openArtist = ref<ArtistSummary | null>(null)
/** 每次新搜索递增，丢掉过期请求的结果 */
let seq = 0

const typeLabels: { value: SearchType; label: string }[] = [
  { value: 'track', label: '歌曲' },
  { value: 'artist', label: '歌手' },
  { value: 'playlist', label: '歌单' },
]

function resetResults(): void {
  page.value = 1
  tracks.value = []
  artists.value = []
  playlists.value = []
  searched.value = false
  done.value = false
}

async function search(reset = true): Promise<void> {
  const keyword = q.value.trim()
  if (!keyword) return
  if (reset) {
    resetResults()
    prefs.addRecentSearch(keyword)
  }
  const mySeq = reset ? ++seq : seq
  loading.value = true
  try {
    const path = `/music/search?type=${type.value}&q=${encodeURIComponent(keyword)}&page=${page.value}`
    const r = await get<unknown[]>(path)
    if (mySeq !== seq) return
    if (type.value === 'track') tracks.value.push(...(r as Track[]))
    else if (type.value === 'artist') artists.value.push(...(r as ArtistSummary[]))
    else playlists.value.push(...(r as PlaylistSummary[]))
    if (r.length < 10) done.value = true
    page.value++
    searched.value = true
  } catch (e) {
    if (mySeq === seq) toastError(e)
  } finally {
    if (mySeq === seq) loading.value = false
  }
}

function setType(v: SearchType): void {
  if (type.value === v) return
  type.value = v
  if (q.value.trim()) void search()
  else resetResults()
}

function onInput(e: Event): void {
  q.value = val(e)
  // 清空输入框（包括点清除按钮）时回到初始页
  if (!q.value.trim()) clear()
}

function clear(): void {
  q.value = ''
  seq++
  loading.value = false
  resetResults()
}

function pick(word: string): void {
  q.value = word
  void search()
}

const hasResults = () => tracks.value.length + artists.value.length + playlists.value.length > 0
</script>

<template>
  <PlaylistTracks v-if="openPlaylist" :playlist="openPlaylist" @back="openPlaylist = null" />
  <ArtistTracks v-else-if="openArtist" :artist="openArtist" @back="openArtist = null" />
  <div v-else class="stack" style="gap: 8px">
    <mdui-text-field
      variant="outlined"
      placeholder="搜索歌曲、歌手或歌单"
      clearable
      :value="q"
      @input="onInput"
      @clear="clear"
      @keydown.enter="search()"
      enterkeyhint="search"
    >
      <mdui-icon-search slot="icon"></mdui-icon-search>
    </mdui-text-field>
    <div class="row chips">
      <mdui-chip
        v-for="t in typeLabels"
        :key="t.value"
        variant="filter"
        :selected="type === t.value"
        @click="setType(t.value)"
      >{{ t.label }}</mdui-chip>
    </div>

    <!-- 还没搜索：最近搜索 + 当前房间状态，不至于一片空白 -->
    <div v-if="!searched && !loading" class="idle stack">
      <div v-if="prefs.recentSearches.length" class="stack" style="gap: 8px">
        <div class="row">
          <span class="title-small spacer">最近搜索</span>
          <mdui-button variant="text" @click="prefs.clearRecentSearches()">清除</mdui-button>
        </div>
        <div class="recent">
          <mdui-chip v-for="w in prefs.recentSearches" :key="w" @click="pick(w)">{{ w }}</mdui-chip>
        </div>
      </div>

      <div class="hero">
        <mdui-icon-library-music class="hero-icon"></mdui-icon-library-music>
        <div class="title-medium">想听什么，搜一下就能点</div>
        <div class="muted">
          可以按歌名、歌手或歌单搜索。点的歌进入队列后，大家投票决定播放顺序。
        </div>
        <div v-if="room.snap" class="muted stats">
          队列里 {{ room.snap.queue.length }} 首 · 已播放 {{ room.snap.history.length }} 首
          <template v-if="room.snap.me.quotaLimit != null">
            · 你已点 {{ room.snap.me.quotaUsed }}/{{ room.snap.me.quotaLimit }}
          </template>
        </div>
      </div>
    </div>

    <template v-else>
      <TrackList v-if="type === 'track'" :tracks="tracks" />
      <mdui-list v-else-if="type === 'artist'">
        <mdui-list-item v-for="a in artists" :key="a.id" :description="a.alias || undefined" @click="openArtist = a">
          <img v-if="a.avatarUrl" slot="icon" class="avatar" :src="coverSrc(a.avatarUrl, 96)" width="40" height="40" alt="" />
          <mdui-avatar v-else slot="icon"><mdui-icon-person></mdui-icon-person></mdui-avatar>
          <span class="ellipsis">{{ a.name }}</span>
        </mdui-list-item>
      </mdui-list>
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
        <mdui-button v-else-if="hasResults() && !done" variant="text" @click="search(false)">加载更多</mdui-button>
        <span v-else-if="searched && !hasResults()" class="muted">没有找到</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chips {
  flex-wrap: wrap;
}
.title-small {
  font-size: var(--mdui-typescale-title-small-size);
  line-height: var(--mdui-typescale-title-small-line-height);
  font-weight: var(--mdui-typescale-title-small-weight);
}
.recent {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.recent mdui-chip {
  max-width: 100%;
}
.idle {
  padding-top: 8px;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  border-radius: var(--mdui-shape-corner-extra-large);
  background: rgb(var(--mdui-color-surface-container-low));
}
.hero-icon {
  font-size: 48px;
  color: rgb(var(--mdui-color-primary));
}
.hero .muted {
  max-width: 360px;
}
.stats {
  margin-top: 4px;
}
.avatar {
  border-radius: 50%;
  object-fit: cover;
  background: rgb(var(--mdui-color-surface-container-highest));
}
</style>
