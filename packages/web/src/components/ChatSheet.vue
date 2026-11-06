<script setup lang="ts">
import ChatPanel from './ChatPanel.vue'
import FullscreenSheet from './FullscreenSheet.vue'

/** 播放页里的聊天：作为覆盖层打开，关掉后回到播放页 */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <FullscreenSheet :open="open" label="聊天" @close="emit('close')">
    <template #header>
      <div class="row header">
        <mdui-button-icon title="收起" @click="emit('close')">
          <mdui-icon-keyboard-arrow-down></mdui-icon-keyboard-arrow-down>
        </mdui-button-icon>
        <div class="title-large spacer">聊天</div>
      </div>
    </template>
    <div class="wrap">
      <ChatPanel safe-bottom />
    </div>
  </FullscreenSheet>
</template>

<style scoped>
.header {
  max-width: 640px;
  margin: 0 auto;
  gap: 0;
}
.wrap {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 8px 16px 0;
  box-sizing: border-box;
}
</style>
