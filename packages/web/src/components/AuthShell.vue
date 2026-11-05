<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="shell">
    <div class="intro">
      <div class="row brand">
        <mdui-avatar><mdui-icon-music-note></mdui-icon-music-note></mdui-avatar>
        <span class="title-medium">聚会音乐播放器</span>
      </div>
      <h1 class="display-small">{{ title }}</h1>
      <p v-if="subtitle" class="muted">{{ subtitle }}</p>
    </div>
    <mdui-card variant="filled">
      <div class="card-pad stack form">
        <slot />
        <div class="row"><slot name="foot" /></div>
      </div>
    </mdui-card>
  </div>
</template>

<style scoped>
.shell {
  max-width: 960px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 32px 16px;
  box-sizing: border-box;
  display: grid;
  gap: 24px;
  align-content: center;
}
.brand {
  gap: 12px;
}
h1 {
  margin: 24px 0 0;
}
p {
  margin: 8px 0 0;
}
.form {
  padding: 24px;
}
@media (min-width: 840px) {
  .shell {
    grid-template-columns: 1fr 400px;
    align-items: center;
    gap: 48px;
  }
}
</style>
