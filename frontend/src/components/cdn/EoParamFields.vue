<template>
  <n-form
    class="eo-params"
    :class="{ 'eo-params--stacked': stacked }"
    :label-placement="stacked ? 'top' : 'left'"
    :label-width="stacked ? undefined : 170"
    size="small"
  >
    <template v-for="f in visibleFields" :key="f.name">
      <!-- 互斥分支（行为选择） -->
      <n-form-item v-if="f.type === 'oneof'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__oneof">
          <EsaCardSelect
            :model-value="activeKey(f)"
            :options="variantOptions(f)"
            compact
            @update:model-value="(v: any) => setVariant(f, String(v))"
          />
          <div v-if="activeVariant(f)" class="eo-params__group eo-params__group--variant">
            <EoParamFields :fields="activeVariant(f)?.fields || []" :model="ensureObj(activeKey(f))" :locale="locale" :stacked="stacked" />
          </div>
        </div>
      </n-form-item>

      <!-- 分组：嵌套对象 -->
      <n-form-item v-else-if="f.type === 'group'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__group">
          <EoParamFields :fields="f.fields || []" :model="ensureGroup(f.name)" :locale="locale" :stacked="stacked" />
        </div>
      </n-form-item>

      <!-- 列表：对象数组（条目卡片 + 序号徽章） -->
      <n-form-item v-else-if="f.type === 'list'" :label="labelOf(f)" :label-props="descProps(f)">
        <div class="eo-params__list">
          <div v-for="(item, i) in listOf(f.name)" :key="i" class="eo-params__list-item">
            <div class="eo-params__list-head">
              <span class="eo-params__list-index">{{ i + 1 }}</span>
              <n-button size="tiny" type="error" quaternary @click="removeItem(f.name, i)">{{ t('cdnRules.actionRemove') }}</n-button>
            </div>
            <div class="eo-params__list-body">
              <EoParamFields :fields="f.itemFields || []" :model="item" :locale="locale" :stacked="stacked" />
            </div>
          </div>
          <n-button size="tiny" dashed block class="eo-params__list-add" @click="addItem(f)">{{ t('cdnRules.actionAdd') }}</n-button>
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
        <EsaCardSelect
          v-else-if="f.type === 'select'"
          :model-value="model[f.name] === undefined || model[f.name] === null ? null : String(model[f.name])"
          :options="optionsOf(f)"
          compact
          clearable
          @update:model-value="(v: any) => setVal(f.name, v)"
        />
        <EoTimeField
          v-else-if="f.type === 'number' && f.time"
          :value="numOrNull(model[f.name])"
          :unit="unitOf(f)"
          :min="f.min"
          :max="f.max"
          :locale="locale"
          @update:value="(v: number | null) => setVal(f.name, v)"
          @update:unit="(u) => setUnit(f.name, u)"
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
          style="width: 100%"
          @update:value="(v: any) => setVal(f.name, v)"
        />
        <n-input v-else :value="strOf(f.name)" size="small" style="width: 100%" :placeholder="placeholderOf(f)" @update:value="(v: string) => setVal(f.name, v)" />
      </n-form-item>
    </template>
  </n-form>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NDynamicTags, NButton, NForm, NFormItem, NInput, NInputNumber, NSwitch } from 'naive-ui';
import type { EoField } from '../../lib/eoRuleSchema';
import type { EoLocale } from '../../lib/eoRuleMeta';
import { pickTimeUnit, type TimeUnit } from '../../lib/eoTime';
import EsaCardSelect from './EsaCardSelect.vue';
import EoTimeField from './EoTimeField.vue';

const props = defineProps<{
  fields: EoField[];
  model: Record<string, any>;
  locale: EoLocale;
  /** 窄屏：标签置顶、控件占满整行 */
  stacked?: boolean;
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
/** 时间字段当前展示单位：优先取模型内已存的选择，否则按秒数自动挑选 */
function unitOf(f: EoField): TimeUnit {
  return props.model.__units?.[f.name] || pickTimeUnit(numOrNull(props.model[f.name]));
}
function setUnit(name: string, u: TimeUnit) {
  if (!props.model.__units || typeof props.model.__units !== 'object') props.model.__units = {};
  props.model.__units[name] = u;
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
/* ===========================================================================
   EO 参数表单 · 卡片分层
   设计意图：动作参数中的嵌套结构（group / oneof / list）一律卡片化，
   白底子卡片落在浅色容器上形成清晰层级；序号徽章使用等宽字体呼应遥测语义。
   =========================================================================== */
.eo-params :deep(.n-form-item-blank) {
  min-width: 0;
}
.eo-params :deep(.n-form-item) {
  margin-bottom: 12px;
}
.eo-params--stacked :deep(.n-form-item) {
  margin-bottom: 14px;
}
.eo-params--stacked :deep(.n-form-item-label) {
  padding-bottom: 4px;
}

/* 嵌套分组 / oneof 生效分支：白底子卡片 + 发丝边框 */
.eo-params__group {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  transition: border-color 0.18s var(--app-ease);
}
.eo-params__group:focus-within {
  border-color: color-mix(in srgb, var(--app-primary) 30%, var(--app-divider));
}
/* oneof 生效分支：顶部虚线分隔，表达「从属于上方选择器」 */
.eo-params__group--variant {
  border-top: 1px dashed var(--app-divider);
  border-radius: 0 0 var(--app-radius) var(--app-radius);
  background: var(--app-surface-2);
}
.eo-params--stacked .eo-params__group {
  padding: 8px 10px;
}
.eo-params__oneof {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 列表：条目卡片纵向堆叠 */
.eo-params__list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.eo-params__list-item {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  padding: 8px 10px 10px;
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.eo-params__list-item:hover {
  border-color: color-mix(in srgb, var(--app-primary) 30%, var(--app-divider));
  box-shadow: var(--app-shadow-sm);
}
.eo-params__list-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--app-divider);
}
.eo-params__list-head .n-button {
  margin-left: auto;
}
/* 序号徽章：等宽数字芯片 */
.eo-params__list-index {
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border-radius: 6px;
  padding: 1px 7px;
  min-width: 22px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.eo-params__list-add {
  height: 30px;
}
</style>
