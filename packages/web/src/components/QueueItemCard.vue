<script setup lang="ts">
import { computed, ref } from 'vue'
import type { QueueItemView } from '@pmp/shared'
import { useRoom } from '../stores/room'
import { coverSrc, fmtTime } from '../ui'

const props = defineProps<{ item: QueueItemView; locked?: boolean; rank?: number }>()
const room = useRoom()
const expanded = ref(false)

const myVote = computed(() => room.optimisticVotes[props.item.id] ?? props.item.myVote)
const voters = computed(() => room.snap?.host?.votersByItem[props.item.id])

function toggleVote(v: 1 | -1): void {
  void room.vote(props.item.id, myVote.value === v ? 0 : v)
}
const hostQueue = (action: 'remove' | 'pin' | 'unpin' | 'setNext') =>
  room.act('host:queue', { action, itemId: props.item.id })
const withdraw = () => room.act('queue:withdraw', { itemId: props.item.id })
</script>

<template>
  <div class="card">
    <div class="row">
      <div v-if="rank !== undefined" class="rank">{{ rank }}</div>
      <img v-if="item.track.coverUrl" class="cover" :src="coverSrc(item.track.coverUrl, 96)" width="44" height="44" alt="" />
      <div class="info" @click="expanded = !expanded">
        <div class="ellipsis">
          <mdui-icon-push-pin v-if="item.pinned" class="pin"></mdui-icon-push-pin>
          {{ item.track.title }}
          <span v-if="item.track.playability === 'trial'" class="tag">试听</span>
        </div>
        <div class="muted ellipsis">
          {{ item.track.artists.join(' / ') }} · {{ fmtTime(item.track.durationMs) }} ·
          {{ item.addedBy.length ? item.addedBy.map((a) => a.nickname).join('、') : '兜底歌单' }}
        </div>
      </div>
      <div class="score" :title="'总分'">{{ locked ? '下一首' : item.score.total.toFixed(1) }}</div>
    </div>

    <div class="row actions">
      <mdui-button-icon :disabled="item.mine" @click="toggleVote(1)" title="赞">
        <mdui-icon-thumb-up v-if="myVote === 1"></mdui-icon-thumb-up>
        <mdui-icon-thumb-up--outlined v-else></mdui-icon-thumb-up--outlined>
      </mdui-button-icon>
      <span class="n">{{ item.up }}</span>
      <mdui-button-icon :disabled="item.mine" @click="toggleVote(-1)" title="踩">
        <mdui-icon-thumb-down v-if="myVote === -1"></mdui-icon-thumb-down>
        <mdui-icon-thumb-down--outlined v-else></mdui-icon-thumb-down--outlined>
      </mdui-button-icon>
      <span class="n">{{ item.down }}</span>
      <span class="spacer"></span>
      <mdui-button v-if="item.mine" variant="text" @click="withdraw">
        <mdui-icon-undo slot="icon"></mdui-icon-undo>撤回
      </mdui-button>
      <mdui-dropdown v-if="room.isHost" placement="bottom-end">
        <mdui-button-icon slot="trigger"><mdui-icon-more-vert></mdui-icon-more-vert></mdui-button-icon>
        <mdui-menu>
          <mdui-menu-item v-if="!locked" @click="hostQueue('setNext')">设为下一首</mdui-menu-item>
          <mdui-menu-item v-if="!item.pinned && !locked" @click="hostQueue('pin')">置顶</mdui-menu-item>
          <mdui-menu-item v-if="item.pinned" @click="hostQueue('unpin')">取消置顶</mdui-menu-item>
          <mdui-menu-item @click="hostQueue('remove')">删除</mdui-menu-item>
        </mdui-menu>
      </mdui-dropdown>
    </div>

    <div v-if="expanded" class="detail muted">
      <div>
        得分构成：投票 {{ item.score.vote }} · 点歌人次 {{ item.score.adds }} · 等待 {{ item.score.order }} · 热门度
        {{ item.score.popularity }} · 时长 {{ item.score.duration }}
      </div>
      <div v-if="voters">
        <span v-if="voters.up.length">赞：{{ voters.up.join('、') }}　</span>
        <span v-if="voters.down.length">踩：{{ voters.down.join('、') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  padding: 12px 12px 4px;
  border-radius: 20px;
  background: rgb(var(--mdui-color-surface-container-low));
}
.rank {
  width: 22px;
  text-align: center;
  color: rgb(var(--mdui-color-primary));
  font-weight: 800;
  font-size: 1rem;
}
.info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  font-weight: 500;
}
.score {
  font-weight: 700;
  font-size: 0.8rem;
  white-space: nowrap;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}
.actions {
  gap: 0;
}
.n {
  min-width: 20px;
  font-size: 0.85rem;
}
.pin {
  font-size: 1rem;
  vertical-align: -2px;
  color: rgb(var(--mdui-color-primary));
}
.tag {
  font-size: 0.7rem;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(var(--mdui-color-tertiary-container));
  color: rgb(var(--mdui-color-on-tertiary-container));
}
.detail {
  padding: 0 4px 8px;
  font-size: 0.8rem;
}
</style>
