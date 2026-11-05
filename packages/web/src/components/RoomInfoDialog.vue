<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoom } from '../stores/room'
import { ask, copyText, toast, val } from '../ui'

/** 房间信息：看房间号、房主改口令、复制邀请链接、关闭房间都收在这里 */
const props = defineProps<{ open: boolean; code: string }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const isHost = computed(() => room.isHost)
const passcode = computed(() => room.snap?.host?.passcode ?? '')
const draft = ref('')
const saving = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) draft.value = passcode.value
  },
)

async function save(): Promise<void> {
  const value = draft.value.trim()
  if (value && (value.length < 4 || value.length > 16)) return toast('口令 4 到 16 位')
  saving.value = true
  const r = await room.act<{ passcode: string }>('host:resetPasscode', value ? { passcode: value } : {})
  saving.value = false
  if (r) {
    draft.value = r.passcode
    toast(`口令已改为 ${r.passcode}`)
  }
}

async function copyInvite(): Promise<void> {
  const text = `${location.origin}/r/${props.code}`
  if (await copyText(text)) toast('邀请链接已复制')
  else toast(text)
}

async function closeRoom(): Promise<void> {
  if (!(await ask('关闭房间？', '队列和聊天记录会被删除，所有人都会退出。', '关闭'))) return
  await room.act('host:close', {})
  emit('close')
}
</script>

<template>
  <mdui-dialog :open="open" headline="房间信息" close-on-overlay-click @close.self="emit('close')">
    <div class="body">
      <div class="muted">房间号</div>
      <div class="code">{{ code }}</div>

      <template v-if="isHost">
        <div class="muted" style="margin-top: 16px">加入口令</div>
        <div class="row">
          <mdui-text-field
            class="spacer"
            variant="outlined"
            maxlength="16"
            :value="draft"
            helper="4 到 16 位，留空则随机生成"
            @input="draft = val($event)"
            @keydown.enter="save"
          />
          <mdui-button variant="tonal" :loading="saving" @click="save">保存</mdui-button>
        </div>
      </template>
      <div v-else class="muted" style="margin-top: 16px">口令由房主管理。</div>

      <div class="row" style="margin-top: 16px">
        <mdui-button variant="tonal" @click="copyInvite">
          <mdui-icon-link slot="icon"></mdui-icon-link>复制邀请链接
        </mdui-button>
      </div>

      <div v-if="isHost" class="danger">
        <mdui-button variant="text" @click="closeRoom">关闭房间</mdui-button>
      </div>
    </div>
    <mdui-button slot="action" variant="text" @click="emit('close')">关闭</mdui-button>
  </mdui-dialog>
</template>

<style scoped>
.body {
  width: min(420px, 100%);
  box-sizing: border-box;
}
.code {
  font-size: 2.25rem;
  font-weight: 500;
  letter-spacing: 4px;
  padding: 4px 0 0;
}
.danger {
  margin-top: 24px;
  border-top: 1px solid rgb(var(--mdui-color-outline-variant));
  padding-top: 8px;
}
</style>
