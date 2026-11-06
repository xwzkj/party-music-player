<script setup lang="ts">
import { nextTick, onActivated, onMounted, ref, watch } from 'vue'
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

const time = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="chat">
    <div ref="box" class="msgs">
      <div class="center" v-if="room.chats.length >= 50 && hasMore">
        <mdui-button variant="text" @click="older">更早的消息</mdui-button>
      </div>
      <template v-for="m in room.chats" :key="m.id">
        <div v-if="m.kind === 'system'" class="sys">{{ m.content }}</div>
        <div v-else class="msg" :class="{ mine: m.userId === room.snap?.me.userId }">
          <div class="who muted">
            {{ m.nickname }} · {{ time(m.createdAt) }}
            <a v-if="room.isHost" href="#" class="del" @click.prevent="room.act('host:chatDelete', { messageId: m.id })">删除</a>
          </div>
          <div class="bubble">{{ m.content }}</div>
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
