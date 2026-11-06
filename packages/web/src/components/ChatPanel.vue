<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import type { ChatMessage } from '@pmp/shared'
import { useRoom } from '../stores/room'
import { toastError, val } from '../ui'

const room = useRoom()
const text = ref('')
const box = ref<HTMLDivElement | null>(null)
const field = ref<HTMLElement | null>(null)
const sending = ref(false)
const hasMore = ref(true)
/** 在全屏面板里使用时，底部要留出安全区 */
defineProps<{ safeBottom?: boolean }>()

function atBottom(): boolean {
  const b = box.value
  return !b || b.scrollHeight - b.scrollTop - b.clientHeight < 80
}
function toBottom(): void {
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}

watch(
  () => room.chats.length,
  async () => {
    const stick = atBottom()
    await nextTick()
    if (stick) toBottom()
  },
)
onMounted(() => nextTick(toBottom))
// 在 KeepAlive 里切回聊天时，滚到最新消息
onActivated(() => nextTick(toBottom))

async function send(): Promise<void> {
  const content = text.value.trim()
  if (!content || sending.value) return
  sending.value = true
  // 点发送按钮会让输入框失焦，手机上键盘随之收起；先记下状态，发完再还原
  const hadFocus = isFieldFocused()
  const ok = await room.act('chat:send', { content })
  sending.value = false
  if (ok !== undefined) {
    text.value = ''
    await nextTick()
    toBottom()
  }
  if (hadFocus) refocus()
}

function isFieldFocused(): boolean {
  const f = field.value
  return !!f && (document.activeElement === f || f.matches(':focus-within'))
}

function refocus(): void {
  // 同步聚焦：在用户手势的调用栈里聚焦，iOS 才不会收起键盘
  ;(field.value as (HTMLElement & { focus: (o?: FocusOptions) => void }) | null)?.focus({ preventScroll: true })
}

/** 发送按钮按下时阻止默认行为，输入框就不会失焦 */
function keepFocus(e: Event): void {
  e.preventDefault()
}

async function older(): Promise<void> {
  try {
    const n = await room.loadOlderChats()
    if (n < 50) hasMore.value = false
  } catch (e) {
    toastError(e)
  }
}

type Entry = { kind: 'user'; msg: ChatMessage } | { kind: 'system'; key: string; msgs: ChatMessage[] }

/** 连续的系统消息合成一组，只显示最后一条，点开可看全部 */
const entries = computed<Entry[]>(() => {
  const out: Entry[] = []
  for (const m of room.chats) {
    const last = out[out.length - 1]
    if (m.kind === 'system') {
      if (last?.kind === 'system') last.msgs.push(m)
      // 用组内第一条的 id 作 key：新系统消息追加进来时，展开状态不会丢
      else out.push({ kind: 'system', key: m.id, msgs: [m] })
    } else {
      out.push({ kind: 'user', msg: m })
    }
  }
  return out
})
const expanded = ref(new Set<string>())
function toggleGroup(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

const time = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="chat">
    <div ref="box" class="msgs">
      <div class="center" v-if="room.chats.length >= 50 && hasMore">
        <mdui-button variant="text" @click="older">更早的消息</mdui-button>
      </div>
      <template v-for="e in entries" :key="e.kind === 'user' ? e.msg.id : e.key">
        <template v-if="e.kind === 'system'">
          <template v-if="e.msgs.length > 1 && expanded.has(e.key)">
            <div v-for="m in e.msgs" :key="m.id" class="sys">{{ m.content }}</div>
            <button type="button" class="sys more" @click="toggleGroup(e.key)">收起</button>
          </template>
          <button
            v-else-if="e.msgs.length > 1"
            type="button"
            class="sys group"
            :title="`展开 ${e.msgs.length} 条系统消息`"
            @click="toggleGroup(e.key)"
          >
            {{ e.msgs[e.msgs.length - 1].content }}<span class="more"> 等{{ e.msgs.length }}条</span>
          </button>
          <div v-else class="sys">{{ e.msgs[0].content }}</div>
        </template>
        <div v-else class="msg" :class="{ mine: e.msg.userId === room.snap?.me.userId }">
          <div class="who muted">
            {{ e.msg.nickname }} · {{ time(e.msg.createdAt) }}
            <a
              v-if="room.isHost"
              href="#"
              class="del"
              @click.prevent="room.act('host:chatDelete', { messageId: e.msg.id })"
            >删除</a>
          </div>
          <div class="bubble">{{ e.msg.content }}</div>
        </div>
      </template>
      <div v-if="!room.chats.length" class="muted center" style="padding: 32px 0">还没有消息</div>
    </div>
    <div class="row input" :class="{ safe: safeBottom }">
      <mdui-text-field
        ref="field"
        variant="outlined"
        class="spacer"
        placeholder="说点什么"
        maxlength="200"
        :value="text"
        @input="text = val($event)"
        @keydown.enter.exact.prevent="send"
        enterkeyhint="send"
      />
      <mdui-button-icon
        variant="filled"
        :disabled="!text.trim()"
        @pointerdown="keepFocus"
        @mousedown="keepFocus"
        @click="send"
      ><mdui-icon-send></mdui-icon-send></mdui-button-icon>
    </div>
  </div>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.msgs {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}
.sys {
  align-self: center;
  font-size: 0.75rem;
  color: rgb(var(--mdui-color-on-surface-variant));
  opacity: 0.8;
  text-align: center;
  max-width: 85%;
}
button.sys {
  border: 0;
  padding: 2px 8px;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
button.sys:hover {
  background: rgba(var(--mdui-color-on-surface), 0.06);
}
/* "等N条"和"收起"用更浅的颜色 */
.more {
  opacity: 0.6;
}
.msg {
  max-width: 80%;
  align-self: flex-start;
}
.msg.mine {
  align-self: flex-end;
  text-align: right;
}
.who {
  font-size: 0.75rem;
}
.bubble {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 16px;
  background: rgb(var(--mdui-color-surface-container-high));
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
}
.mine .bubble {
  background: rgb(var(--mdui-color-primary-container));
  color: rgb(var(--mdui-color-on-primary-container));
}
.del {
  margin-left: 4px;
  font-size: 0.75rem;
}
.input {
  padding-top: 4px;
}
.input.safe {
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}
</style>
