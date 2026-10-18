<template>
  <n-popover v-if="errors?.length" trigger="click" placement="bottom-end">
    <template #trigger>
      <button type="button" class="chip" :class="`is-${status}`">
        <i class="chip__dot" />
        {{ label }}
      </button>
    </template>
    <ul class="chip__errors">
      <li v-for="(err, i) in errors" :key="i">{{ err }}</li>
    </ul>
  </n-popover>
  <span v-else class="chip" :class="`is-${status}`">
    <i class="chip__dot" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NPopover } from 'naive-ui';

const props = defineProps<{ status: string; errors?: string[] }>();
const { t } = useI18n();

const label = computed(() => t(`statistics.status.${props.status || 'ok'}`));
</script>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: var(--app-surface);
  color: var(--app-text-2);
  font-size: 12px;
  cursor: default;
}
button.chip {
  cursor: pointer;
}
.chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--app-text-3);
}
.chip.is-ok .chip__dot {
  background: var(--app-success);
}
.chip.is-partial .chip__dot {
  background: var(--app-warning);
}
.chip.is-error .chip__dot {
  background: var(--app-error);
}
.chip__errors {
  margin: 0;
  padding-left: 16px;
  max-width: 320px;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}
</style>
