<script setup lang="ts">
import { computed } from 'vue'
import { useRoom } from '../stores/room'
import { ask } from '../ui'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const members = computed(() => room.snap?.members ?? [])
const bans = computed(() => room.snap?.host?.bans ?? [])

async function kick(id: string, nickname: string, ban: boolean): Promise<void> {
  const desc = ban ? '对方将不能再进入这个房间。' : '对方以后还可以凭口令重新加入。'
  if (!(await ask(`把 ${nickname} 移出房间？`, desc, '移出'))) return
  await room.act('host:kick', { userId: id, ban })
}
</script>

<template>
  <mdui-dialog :open="open" headline="成员与禁入" close-on-overlay-click @close.self="emit('close')">
    <mdui-list class="list">
      <mdui-list-item v-for="m in members" :key="m.id" nonclickable>
        {{ m.nickname }}
        <span slot="description">
          {{ m.isHost ? '房主 · ' : '' }}{{ m.present ? '在场' : '不在场' }}{{ m.listening ? ' · 出声中' : '' }}
        </span>
        <div v-if="room.isHost && !m.isHost" slot="end-icon" class="row">
          <mdui-button variant="text" @click="kick(m.id, m.nickname, false)">移出</mdui-button>
          <mdui-button variant="text" @click="kick(m.id, m.nickname, true)">禁入</mdui-button>
        </div>
      </mdui-list-item>
    </mdui-list>
    <template v-if="bans.length">
      <div style="font-weight: 500; margin-top: 8px">禁入名单</div>
      <mdui-list>
        <mdui-list-item v-for="b in bans" :key="b.id" nonclickable>
          {{ b.nickname }}
          <mdui-button slot="end-icon" variant="text" @click="room.act('host:unban', { userId: b.id })">解除</mdui-button>
        </mdui-list-item>
      </mdui-list>
    </template>
    <mdui-button slot="action" variant="text" @click="emit('close')">关闭</mdui-button>
  </mdui-dialog>
</template>

<style scoped>
.list {
  width: min(420px, 100%);
  box-sizing: border-box;
}
</style>
