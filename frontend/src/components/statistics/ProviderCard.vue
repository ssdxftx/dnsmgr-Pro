<template>
  <article class="pcard" :class="[`pcard--${data.tone}`, `is-${data.status}`]" :data-status="data.status">
    <header class="pcard__head">
      <span class="pcard__logo"><n-icon size="20" :component="icon" /></span>
      <div class="pcard__title">
        <h3>{{ data.name }}</h3>
        <p v-if="data.accountCount || data.domainCount">
          {{ t('statistics.cardMeta', { accounts: data.accountCount, domains: data.domainCount }) }}
        </p>
        <p v-else>{{ t('statistics.cacheDataHintShort') }}</p>
      </div>
      <span class="pcard__dot" :class="`is-${data.status}`" :title="t(`statistics.status.${data.status}`)" />
    </header>

    <div v-if="loading" class="pcard__basics">
      <div v-for="i in 5" :key="i" class="pcard__metric">
        <n-skeleton text style="width: 56px; height: 11px" />
        <n-skeleton text style="width: 84px; height: 17px; margin-top: 4px" />
      </div>
    </div>
    <div v-else-if="data.basics.length && data.status !== 'error' && data.status !== 'timeout'" class="pcard__basics">
      <div v-for="b in data.basics" :key="b.key" class="pcard__metric">
        <span class="pcard__label">{{ t(`statistics.basic.${b.key}`) }}</span>
        <span class="pcard__value">{{ formatMetric(b.value, b.unit) }}</span>
      </div>
    </div>
    <div v-else class="pcard__empty">
      {{ emptyText }}
    </div>

    <footer class="pcard__foot">
      <span class="pcard__time">{{ t('statistics.updatedAt', { time: data.dataUntil }) }}</span>
      <n-button
        size="small"
        secondary
        type="primary"
        :disabled="data.status === 'empty'"
        :loading="loading"
        @click="$emit('detail', data.route)"
      >
        {{ t('statistics.detailData') }}
        <template #icon><n-icon :component="ArrowForwardOutline" /></template>
      </n-button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NIcon, NSkeleton } from 'naive-ui';
import { ArrowForwardOutline, CloudOutline, ServerOutline } from '@vicons/ionicons5';
import { formatMetric, type MetricUnit } from '../../lib/statistics/format';

export interface ProviderCardData {
  route: string;
  name: string;
  tone: string;
  status: 'ok' | 'partial' | 'empty' | 'error' | 'timeout';
  accountCount: number;
  domainCount: number;
  basics: Array<{ key: string; unit: MetricUnit; value: number | null }>;
  error?: string;
  dataUntil: string;
  cached: boolean;
  tookMs: number;
}

const props = withDefaults(defineProps<{ data: ProviderCardData; loading?: boolean }>(), {
  loading: false,
});

defineEmits<{ (e: 'detail', route: string): void }>();

const { t } = useI18n();

const icon = computed(() => (props.data.route === 'tencent_edgeone' || props.data.route === 'tencent_cdn' ? CloudOutline : ServerOutline));

const emptyText = computed(() => {
  if (props.data.status === 'empty') return t('statistics.notConnected');
  if (props.data.status === 'timeout') return t('statistics.timeout');
  if (props.data.status === 'error') return t('statistics.loadFailed');
  return t('statistics.noData');
});
</script>

<style scoped>
.pcard {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  padding: 16px 18px 12px;
  box-shadow: var(--app-shadow-sm);
  transition:
    transform var(--app-dur-fast) var(--app-ease),
    box-shadow var(--app-dur-fast) var(--app-ease),
    border-color var(--app-dur-fast) var(--app-ease);
}
.pcard:hover {
  transform: translateY(-2px);
  box-shadow: var(--app-shadow);
  border-color: color-mix(in srgb, var(--app-primary) 35%, var(--app-border));
}
.pcard::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--app-primary);
}
.pcard--info::before {
  background: #14b8a6;
}
.pcard--success::before {
  background: var(--app-success);
}
.pcard--warning::before {
  background: var(--app-warning);
}
.pcard.is-empty {
  opacity: 0.72;
}
.pcard.is-partial {
  border-top: 2px solid var(--app-warning);
}
.pcard.is-error,
.pcard.is-timeout {
  border-color: color-mix(in srgb, var(--app-error) 45%, var(--app-border));
}
.pcard__head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pcard__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-primary) 12%, transparent);
  color: var(--app-primary);
}
.pcard--info .pcard__logo {
  background: color-mix(in srgb, #14b8a6 14%, transparent);
  color: #0f8f83;
}
.pcard--success .pcard__logo {
  background: color-mix(in srgb, var(--app-success) 14%, transparent);
  color: var(--app-success);
}
.pcard--warning .pcard__logo {
  background: color-mix(in srgb, var(--app-warning) 16%, transparent);
  color: var(--app-warning);
}
.pcard__title {
  min-width: 0;
  flex: 1;
}
.pcard__title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcard__title p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--app-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcard__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--app-text-3);
}
.pcard__dot.is-ok {
  background: var(--app-success);
}
.pcard__dot.is-partial {
  background: var(--app-warning);
}
.pcard__dot.is-error {
  background: var(--app-error);
}
.pcard__basics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 14px 0 12px;
}
.pcard__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pcard__label {
  font-size: 11px;
  color: var(--app-text-3);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcard__value {
  font-family: var(--app-font-mono);
  font-size: 17px;
  font-weight: 600;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcard__empty {
  margin: 18px 0 14px;
  min-height: 54px;
  display: flex;
  align-items: center;
  font-size: 13px;
  color: var(--app-text-3);
}
.pcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--app-divider);
}
.pcard__time {
  font-size: 11px;
  color: var(--app-text-3);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 767px) {
  .pcard {
    padding: 14px 14px 10px;
  }
  .pcard__value {
    font-size: 16px;
  }
  .pcard__foot :deep(.n-button) {
    min-height: 36px;
  }
}
</style>
