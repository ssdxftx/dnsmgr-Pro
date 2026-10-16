<template>
  <n-modal
    :show="show"
    preset="card"
    :title="t('cdnRules.tplTitle')"
    style="width: min(900px, calc(100vw - 24px))"
    :mask-closable="true"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="tpl-hint">{{ t('cdnRules.tplHint') }}</div>
    <div class="tpl-grid">
      <button v-for="tpl in templates" :key="tpl.id" type="button" class="tpl-card" @click="emit('select', tpl.id)">
        <span class="tpl-card__title">{{ bi(tpl.label) }}</span>
        <span class="tpl-card__desc">{{ bi(tpl.desc) }}</span>
      </button>
      <button type="button" class="tpl-card tpl-card--blank" @click="emit('select', '')">
        <span class="tpl-card__title">{{ t('cdnRules.tplBlank') }}</span>
        <span class="tpl-card__desc">{{ t('cdnRules.tplBlankDesc') }}</span>
      </button>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NModal } from 'naive-ui';
import { EO_RULE_TEMPLATES, type EoRuleTemplate } from '../../lib/eoRuleTemplates';

defineProps<{ show: boolean }>();
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void;
  (e: 'select', id: string): void;
}>();

const { t, locale } = useI18n();
const templates = computed<EoRuleTemplate[]>(() => EO_RULE_TEMPLATES);
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

function bi(b: { zh: string; en: string }): string {
  return isZh.value ? b.zh : b.en;
}
</script>

<style scoped>
.tpl-hint {
  font-size: 13px;
  color: var(--app-text-3);
  margin-bottom: 12px;
}
.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.tpl-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  text-align: left;
  padding: 14px 14px 16px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  cursor: pointer;
  transition: border-color 0.2s var(--app-ease), background 0.2s var(--app-ease), transform 0.2s var(--app-ease);
  font: inherit;
  color: inherit;
}
.tpl-card:hover {
  border-color: var(--app-primary);
  background: var(--app-bg-soft);
  transform: translateY(-1px);
}
.tpl-card__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text-1);
}
.tpl-card__desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--app-text-3);
}
.tpl-card--blank {
  border-style: dashed;
}
@media (max-width: 767px) {
  .tpl-grid {
    grid-template-columns: 1fr;
  }
}
</style>