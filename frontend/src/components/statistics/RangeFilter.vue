<template>
  <div class="range-filter">
    <n-radio-group v-if="!isMobile" :value="range" class="filter-range" @update:value="onRange">
      <n-radio-button v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</n-radio-button>
    </n-radio-group>
    <div v-else class="range-pills">
      <n-button
        v-for="opt in options"
        :key="opt.value"
        size="small"
        :type="range === opt.value ? 'primary' : 'default'"
        :secondary="range !== opt.value"
        @click="onRange(opt.value)"
      >
        {{ opt.label }}
      </n-button>
    </div>
    <template v-if="range === 'custom'">
      <n-date-picker
        v-if="!isMobile"
        :value="customRange"
        type="datetimerange"
        format="yyyy-MM-dd HH:mm:ss"
        class="filter-datetime"
        clearable
        @update:value="onCustomRange"
      />
      <template v-else>
        <n-date-picker
          :value="customStart"
          type="datetime"
          format="yyyy-MM-dd HH:mm:ss"
          class="filter-datetime"
          :placeholder="t('statistics.startTime')"
          clearable
          @update:value="onCustomStart"
        />
        <n-date-picker
          :value="customEnd"
          type="datetime"
          format="yyyy-MM-dd HH:mm:ss"
          class="filter-datetime"
          :placeholder="t('statistics.endTime')"
          clearable
          @update:value="onCustomEnd"
        />
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useResponsive } from '../../composables/useResponsive';

const props = defineProps<{
  range: string;
  customRange: [number, number] | null;
  isAdmin: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:range', value: string): void;
  (e: 'update:customRange', value: [number, number] | null): void;
  (e: 'change'): void;
}>();

const { t } = useI18n();
const { isMobile } = useResponsive();

const options = computed(() => {
  const list = [
    { label: t('statistics.range24h'), value: '24h' },
    { label: t('statistics.rangeToday'), value: 'today' },
    { label: t('statistics.range7d'), value: '7d' },
    { label: t('statistics.range30d'), value: '30d' },
    { label: t('statistics.rangeCustom'), value: 'custom' },
  ];
  return props.isAdmin ? list : list.filter((o) => o.value !== 'custom');
});

const customStart = ref<number | null>(props.customRange?.[0] ?? null);
const customEnd = ref<number | null>(props.customRange?.[1] ?? null);

watch(
  () => props.customRange,
  (v) => {
    customStart.value = v?.[0] ?? null;
    customEnd.value = v?.[1] ?? null;
  },
);

function onRange(value: string) {
  emit('update:range', value);
  emit('change');
}

function onCustomRange(value: [number, number] | null) {
  emit('update:customRange', value);
  emit('change');
}

function syncParts() {
  const value: [number, number] | null =
    customStart.value != null && customEnd.value != null ? [customStart.value, customEnd.value] : null;
  emit('update:customRange', value);
  emit('change');
}

function onCustomStart(value: number | null) {
  customStart.value = value;
  syncParts();
}

function onCustomEnd(value: number | null) {
  customEnd.value = value;
  syncParts();
}
</script>

<style scoped>
.range-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.filter-range {
  max-width: 100%;
}
.range-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.range-pills :deep(.n-button) {
  flex: 1 1 auto;
  min-width: 72px;
  min-height: 36px;
}
.filter-datetime {
  width: 340px;
}
@media (max-width: 767px) {
  .filter-datetime {
    width: 100%;
  }
}
</style>
