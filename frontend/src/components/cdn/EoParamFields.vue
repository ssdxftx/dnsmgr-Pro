<template>
  <n-form label-placement="left" label-width="170" size="small">
    <template v-for="f in visibleFields" :key="f.name">
      <!-- 互斥分支（行为选择） -->
      <n-form-item v-if="f.type === 'oneof'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__oneof">
          <n-select :value="activeKey(f)" :options="variantOptions(f)" size="small" @update:value="(v: string) => setVariant(f, v)" />
          <div v-if="activeVariant(f)" class="eo-params__group">
            <EoParamFields :fields="activeVariant(f)?.fields || []" :model="ensureObj(activeKey(f))" :locale="locale" />
          </div>
        </div>
      </n-form-item>

      <!-- 分组：嵌套对象 -->
      <n-form-item v-else-if="f.type === 'group'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__group">
          <EoParamFields :fields="f.fields || []" :model="ensureGroup(f.name)" :locale="locale" />
        </div>
      </n-form-item>

      <!-- 列表：对象数组 -->
      <n-form-item v-else-if="f.type === 'list'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__list">
          <div v-for="(item, i) in listOf(f.name)" :key="i" class="eo-params__list-item">
            <div class="eo-params__list-body">
              <EoParamFields :fields="f.itemFields || []" :model="item" :locale="locale" />
            </div>
            <n-button size="tiny" type="error" quaternary @click="removeItem(f.name, i)">{{ t('cdnRules.actionRemove') }}</n-button>
          </div>
          <n-button size="tiny" dashed block @click="addItem(f)">{{ t('cdnRules.actionAdd') }}</n-button>
        </div>
      </n-form-item>

      <!-- 标量 -->
      <n-form-item v-else :label="labelOf(f)" :label-props="descProps(f)">
        <n-switch
          v-if="f.type === 'switch'"
          :value="model[f.name] === onValue(f)"
          size="small"
          @update:value="(v: boolean) => (model[f.name] = v ? onValue(f) : offValue(f))"
        />
        <n-select
          v-else-if="f.type === 'select'"
          :value="model[f.name] === undefined || model[f.name] === null ? null : String(model[f.name])"
          :options="optionsOf(f)"
          size="small"
          clearable
          @update:value="(v: any) => setVal(f.name, v)"
        />
        <n-input-number
          v-else-if="f.type === 'number'"
          :value="numOrNull(model[f.name])"
          :min="f.min"
          :max="f.max"
          size="small"
          clearable
          style="width: 100%"
          @update:value="(v: any) => setVal(f.name, v)"
        />
        <n-dynamic-tags
          v-else-if="f.type === 'tags'"
          :value="arrOf(f.name)"
          size="small"
          @update:value="(v: any) => setVal(f.name, v)"
        />
        <n-input v-else :value="strOf(f.name)" size="small" :placeholder="placeholderOf(f)" @update:value="(v: string) => setVal(f.name, v)" />
      </n-form-item>
    </template>
  </n-form>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NDynamicTags, NButton, NForm, NFormItem, NInput, NInputNumber, NSelect, NSwitch } from 'naive-ui';
import type { EoField } from '../../lib/eoRuleSchema';
import type { EoLocale } from '../../lib/eoRuleMeta';

const props = defineProps<{
  fields: EoField[];
  model: Record<string, any>;
  locale: EoLocale;
}>();

const { t } = useI18n();

const visibleFields = computed(() => props.fields.filter((f) => !f.showIf || f.showIf(props.model)));

function labelOf(f: EoField): string {
  return props.locale === 'zh' ? f.label.zh : f.label.en;
}
function descProps(f: EoField) {
  return f.desc ? { title: props.locale === 'zh' ? f.desc.zh : f.desc.en } : undefined;
}
function placeholderOf(f: EoField): string | undefined {
  return f.placeholder ? (props.locale === 'zh' ? f.placeholder.zh : f.placeholder.en) : undefined;
}
function optionsOf(f: EoField) {
  return (f.options || []).map((o) => ({ label: props.locale === 'zh' ? o.label.zh : o.label.en, value: o.value }));
}
function onValue(f: EoField): string {
  return f.options?.find((o) => o.value === 'on')?.value || 'on';
}
function offValue(f: EoField): string {
  return f.options?.find((o) => o.value === 'off')?.value || 'off';
}
function setVal(name: string, v: any) {
  if (v === undefined || v === null || v === '') delete props.model[name];
  else props.model[name] = v;
}
function strOf(name: string): string {
  const v = props.model[name];
  return v === undefined || v === null ? '' : String(v);
}
function arrOf(name: string): string[] {
  const v = props.model[name];
  return Array.isArray(v) ? v : [];
}
function numOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== null ? n : null;
}
function ensureGroup(name: string): Record<string, any> {
  if (!props.model[name] || typeof props.model[name] !== 'object' || Array.isArray(props.model[name])) props.model[name] = {};
  return props.model[name];
}
function ensureObj(name: string): Record<string, any> {
  return ensureGroup(name);
}
/** oneof：当前生效分支（以子对象 Switch=on 判定，回退到首个已存在的分支，再回退到首项） */
function activeKey(f: EoField): string {
  const variants = f.variants || [];
  const on = variants.find((v) => props.model[v.key] && props.model[v.key].Switch === 'on');
  if (on) return on.key;
  const present = variants.find((v) => props.model[v.key] && typeof props.model[v.key] === 'object');
  if (present) return present.key;
  return variants[0]?.key || '';
}
function activeVariant(f: EoField) {
  const key = activeKey(f);
  return (f.variants || []).find((v) => v.key === key);
}
function variantOptions(f: EoField) {
  return (f.variants || []).map((v) => ({ label: props.locale === 'zh' ? v.label.zh : v.label.en, value: v.key }));
}
function setVariant(f: EoField, key: string) {
  for (const v of f.variants || []) {
    if (v.key === key) ensureObj(v.key).Switch = 'on';
    else if (props.model[v.key] && typeof props.model[v.key] === 'object') props.model[v.key].Switch = 'off';
  }
}
function listOf(name: string): Record<string, any>[] {
  if (!Array.isArray(props.model[name])) props.model[name] = [];
  return props.model[name];
}
function addItem(f: EoField) {
  const arr = listOf(f.name);
  arr.push(f.newItem ? f.newItem() : {});
}
function removeItem(name: string, index: number) {
  const arr = listOf(name);
  arr.splice(index, 1);
}
</script>

<style scoped>
.eo-params__group {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-bg-soft);
}
.eo-params__oneof {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eo-params__list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eo-params__list-item {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  padding: 8px 10px;
  background: var(--app-bg-soft);
}
.eo-params__list-body {
  margin-bottom: 4px;
}
</style>
