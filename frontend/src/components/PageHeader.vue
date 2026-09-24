<template>
  <div v-if="title || subtitle || $slots.actions" class="page-header">
    <div class="page-header__left">
      <n-button v-if="back" quaternary circle class="page-header__back" @click="goBack">
        <template #icon><n-icon :component="ArrowBackOutline" /></template>
      </n-button>
      <div class="page-header__text">
        <h1 class="page-header__title">
          {{ title }}
          <slot name="title-suffix" />
        </h1>
        <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';
import { useRouter } from 'vue-router';

const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    back?: string | boolean;
  }>(),
  { title: '', subtitle: '', back: false },
);

const router = useRouter();

function goBack() {
  if (typeof props.back === 'string') router.push(props.back);
  else router.back();
}
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.page-header__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.page-header__back {
  margin-left: -6px;
}
.page-header__text {
  min-width: 0;
}
.page-header__title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--app-text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-header__subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 767px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .page-header__actions {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .page-header__actions :deep(.n-button) {
    flex-shrink: 0;
  }
}
</style>