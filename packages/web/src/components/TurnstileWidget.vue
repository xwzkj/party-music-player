<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ token: [string] }>()
const el = ref<HTMLDivElement | null>(null)
let widgetId: string | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Turnstile 加载失败'))
    document.head.appendChild(s)
  })
}

onMounted(async () => {
  await loadScript()
  if (!el.value || !window.turnstile) return
  widgetId = window.turnstile.render(el.value, {
    sitekey: props.siteKey,
    callback: (t) => emit('token', t),
    'expired-callback': () => emit('token', ''),
  })
})

onBeforeUnmount(() => {
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
})

defineExpose({
  reset: () => {
    if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
    emit('token', '')
  },
})
</script>

<template>
  <div ref="el"></div>
</template>
