<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoom } from '../stores/room'
import { ask, checked, copyText, toast, val } from '../ui'

/** 房间信息：房间号与邀请链接、房主改口令、关闭房间 */
const props = defineProps<{ open: boolean; code: string }>()
const emit = defineEmits<{ close: [] }>()
const room = useRoom()
const isHost = computed(() => room.isHost)
const passcode = computed(() => room.snap?.host?.passcode ?? '')
const withPasscode = ref(false)
const inviteUrl = computed(() => {
  const base = `${location.origin}/r/${props.code}`
  return withPasscode.value && passcode.value ? `${base}?p=${encodeURIComponent(passcode.value)}` : base
})
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const field = ref<HTMLElement | null>(null)
const linkEl = ref<HTMLElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (open) {
      editing.value = false
      withPasscode.value = false
    }
  },
)

async function startEdit(): Promise<void> {
  draft.value = passcode.value
  editing.value = true
  await nextTick()
  ;(field.value as (HTMLElement & { focus: (o?: FocusOptions) => void }) | null)?.focus()
}

function cancelEdit(): void {
  editing.value = false
}

async function save(): Promise<void> {
  const value = draft.value.trim()
  if (value && (value.length < 4 || value.length > 16)) return toast('口令 4 到 16 位')
  saving.value = true
  const r = await room.act<{ passcode: string }>('host:resetPasscode', value ? { passcode: value } : {})
  saving.value = false
  if (r) {
    editing.value = false
    toast(`口令已改为 ${r.passcode}`)
  }
}

/** 复制失败时把链接选中，方便长按或 Ctrl+C 手动复制 */
function selectLink(): void {
  const el = linkEl.value
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

async function copyInvite(): Promise<void> {
  if (await copyText(inviteUrl.value)) {
    toast('邀请链接已复制')
  } else {
    selectLink()
    toast('浏览器不允许自动复制，链接已选中，请手动复制')
  }
}

async function closeRoom(): Promise<void> {
  if (!(await ask('关闭房间？', '所有人都会被移出，队列和聊天记录会被删除，无法恢复。', '关闭房间'))) return
  await room.act('host:close', {})
  emit('close')
}
</script>

<template>
  <mdui-dialog :open="open" headline="房间信息" close-on-overlay-click @close.self="emit('close')">
    <div class="body">
      <section class="block">
        <div class="label">房间号</div>
        <div class="code">{{ code }}</div>
        <div class="link-row">
          <span ref="linkEl" class="link" @click="selectLink">{{ inviteUrl }}</span>
        </div>
        <div v-if="isHost" class="row include">
          <span class="spacer">链接包含口令</span>
          <mdui-switch :checked="withPasscode" @change="withPasscode = checked($event)"></mdui-switch>
        </div>
        <div v-if="isHost && withPasscode" class="muted">
          收到链接的人可以直接进房间，不用再输口令。
        </div>
        <mdui-button variant="tonal" full-width @click="copyInvite">
          <mdui-icon-link slot="icon"></mdui-icon-link>复制邀请链接
        </mdui-button>
      </section>

      <section class="block">
        <div class="label">加入口令</div>
        <template v-if="!isHost">
          <div class="muted">口令由房主管理，需要时请向房主询问。</div>
        </template>
        <template v-else-if="!editing">
          <div class="pass-row">
            <span class="pass">{{ passcode }}</span>
            <mdui-button variant="text" @click="startEdit">
              <mdui-icon-edit slot="icon"></mdui-icon-edit>修改
            </mdui-button>
          </div>
        </template>
        <template v-else>
          <mdui-text-field
            ref="field"
            variant="outlined"
            maxlength="16"
            placeholder="留空则随机生成"
            helper="4 到 16 位"
            :value="draft"
            @input="draft = val($event)"
            @keydown.enter.prevent="save"
            @keydown.esc.stop.prevent="cancelEdit"
          />
          <div class="edit-actions">
            <mdui-button variant="text" @click="cancelEdit">取消</mdui-button>
            <mdui-button variant="tonal" :loading="saving" @click="save">保存口令</mdui-button>
          </div>
        </template>
      </section>

      <section v-if="isHost" class="danger">
        <div class="danger-text">
          <div class="danger-title">关闭房间</div>
          <div class="muted">所有人都会被移出，队列和聊天记录会被删除。</div>
        </div>
        <mdui-button variant="outlined" class="danger-btn" @click="closeRoom">关闭房间</mdui-button>
      </section>
    </div>
    <mdui-button slot="action" variant="text" @click="emit('close')">完成</mdui-button>
  </mdui-dialog>
</template>

<style scoped>
.body {
  width: min(400px, 100%);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label {
  font-size: var(--mdui-typescale-label-large-size);
  font-weight: var(--mdui-typescale-label-large-weight);
  color: rgb(var(--mdui-color-on-surface-variant));
}
.code {
  font-size: 2.25rem;
  line-height: 1.2;
  font-weight: 500;
  letter-spacing: 4px;
  font-variant-numeric: tabular-nums;
}
.link-row {
  padding: 8px 12px;
  border-radius: var(--mdui-shape-corner-medium);
  background: rgb(var(--mdui-color-surface-container-highest));
}
/* 链接可以选中，复制失败时用户能长按手动复制 */
.link {
  display: block;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  user-select: all;
  -webkit-user-select: all;
  cursor: text;
}
.pass-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
}
.include {
  align-items: center;
  min-height: 32px;
}
.pass {
  flex: 1;
  min-width: 0;
  font-size: 1.5rem;
  font-weight: 500;
  letter-spacing: 2px;
  overflow-wrap: anywhere;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.danger {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  border-radius: var(--mdui-shape-corner-large);
  background: rgba(var(--mdui-color-error-container), 0.5);
}
.danger-text {
  flex: 1;
  min-width: 160px;
}
.danger-title {
  font-weight: 500;
  color: rgb(var(--mdui-color-error));
}
/* 只改按钮自己的颜色令牌，和普通按钮明显区分 */
.danger-btn {
  --mdui-color-primary: var(--mdui-color-error);
  --mdui-color-outline: var(--mdui-color-error);
}
</style>
