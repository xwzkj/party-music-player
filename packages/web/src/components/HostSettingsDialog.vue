<script setup lang="ts">
import { ref, watch } from 'vue'
import type { RoomSettings, VoteMode, Weights } from '@pmp/shared'
import { post } from '../api/http'
import { useRoom } from '../stores/room'
import { checked, toast, toastError, val } from '../ui'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const form = ref<RoomSettings | null>(null)
const quotaText = ref('')
const fallbackLink = ref('')
const saving = ref(false)

const weightLabels: { key: keyof Weights; label: string }[] = [
  { key: 'vote', label: '投票' },
  { key: 'adds', label: '点歌人次' },
  { key: 'order', label: '等待时间' },
  { key: 'popularity', label: '热门度' },
  { key: 'duration', label: '时长（短歌优先）' },
]

watch(
  () => props.open,
  (o) => {
    if (!o || !room.snap) return
    form.value = JSON.parse(JSON.stringify(room.snap.room.settings))
    quotaText.value = form.value!.quotaPerMember === null ? '' : String(form.value!.quotaPerMember)
    fallbackLink.value = form.value!.fallbackPlaylistId ?? ''
  },
  { immediate: true },
)

async function save(): Promise<void> {
  if (!form.value) return
  saving.value = true
  try {
    const q = quotaText.value.trim()
    const quota = q === '' ? null : Number(q)
    if (quota !== null && (!Number.isInteger(quota) || quota < 1)) throw new Error('配额必须是正整数，留空表示不限')
    let fallback: string | null = null
    if (fallbackLink.value.trim()) {
      fallback = (await post<{ id: string }>('/music/playlist/resolve', { link: fallbackLink.value })).id
    }
    const ok = await room.act('host:settings', { ...form.value, quotaPerMember: quota, fallbackPlaylistId: fallback })
    if (ok !== undefined) {
      toast('设置已保存')
      emit('close')
    }
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

function setWeight(key: keyof Weights, e: Event): void {
  if (form.value) form.value.weights[key] = Number(val(e)) / 10
}
</script>

<template>
  <mdui-dialog :open="open" headline="房间设置" close-on-overlay-click @close.self="emit('close')">
    <div v-if="form" class="stack" style="gap: 12px; min-width: min(420px, 80vw)">
      <div>
        <div class="muted">切歌、上一曲、暂停、继续的投票模式</div>
        <mdui-select :value="form.voteMode" @change="form.voteMode = val($event) as VoteMode">
          <mdui-menu-item value="anyone">任何人</mdui-menu-item>
          <mdui-menu-item value="half">一半以上（至少一半）</mdui-menu-item>
          <mdui-menu-item value="all">所有人</mdui-menu-item>
        </mdui-select>
      </div>
      <mdui-text-field
        label="每人点歌配额"
        helper="留空表示不限；只统计还在队列里待播的歌"
        type="number"
        :value="quotaText"
        @input="quotaText = val($event)"
      />
      <div>
        <div class="muted">排序权重（按比例）</div>
        <div v-for="w in weightLabels" :key="w.key" class="row">
          <span style="width: 120px">{{ w.label }}</span>
          <mdui-slider class="spacer" :value="Math.round(form.weights[w.key] * 10)" max="100" @change="setWeight(w.key, $event)"></mdui-slider>
          <span style="width: 32px; text-align: right">{{ form.weights[w.key].toFixed(1) }}</span>
        </div>
      </div>
      <div class="row">
        <span class="spacer">成员设备默认出声</span>
        <mdui-switch :checked="form.memberAudioDefault" @change="form.memberAudioDefault = checked($event)"></mdui-switch>
      </div>
      <div class="row">
        <span class="spacer">允许点只能试听的歌</span>
        <mdui-switch :checked="form.allowTrialTracks" @change="form.allowTrialTracks = checked($event)"></mdui-switch>
      </div>
      <div>
        <div class="muted">音质</div>
        <mdui-select :value="form.audioLevel" @change="form.audioLevel = val($event) as RoomSettings['audioLevel']">
          <mdui-menu-item value="standard">标准</mdui-menu-item>
          <mdui-menu-item value="exhigh">极高（会员）</mdui-menu-item>
          <mdui-menu-item value="lossless">无损（会员）</mdui-menu-item>
        </mdui-select>
      </div>
      <mdui-text-field
        label="兜底歌单（链接或 id，可选）"
        helper="队列空了就从里面随机播放"
        :value="fallbackLink"
        @input="fallbackLink = val($event)"
      />
    </div>
    <mdui-button slot="action" variant="text" @click="emit('close')">取消</mdui-button>
    <mdui-button slot="action" :loading="saving" @click="save">保存</mdui-button>
  </mdui-dialog>
</template>
