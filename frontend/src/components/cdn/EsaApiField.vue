<template>
  <div class="esa-field" :class="{ 'esa-field--nested': depth > 0, 'esa-field--root': depth === 0 }">
    <div class="esa-field__head">
      <span class="esa-field__name">{{ field.name }}</span>
      <span v-if="field.required" class="esa-field__required">*</span>
      <n-tag size="tiny" :bordered="false">{{ field.type }}</n-tag>
    </div>
    <div v-if="field.desc" class="esa-field__desc">{{ field.desc }}</div>

    <div class="esa-field__control">
      <n-input
        v-if="isSiteId"
        :value="siteId"
        disabled
        size="small"
        :placeholder="field.example || ''"
      />
      <EsaCardSelect
        v-else-if="field.enum?.length"
        :model-value="modelValue"
        :options="enumOptions"
        compact
        clearable
        searchable
        @update:model-value="emitValue"
      />
      <n-switch
        v-else-if="field.type === 'boolean'"
        :value="boolValue"
        size="small"
        @update:value="emitValue"
      />
      <n-input
        v-else-if="field.type === 'integer' && field.format === 'int64'"
        :value="modelValue"
        size="small"
        :placeholder="field.example || ''"
        @update:value="emitValue"
      />
      <n-input-number
        v-else-if="field.type === 'integer' || field.type === 'number'"
        :value="numValue"
        size="small"
        :placeholder="field.example || ''"
        clearable
        @update:value="emitValue"
      />
      <div v-else-if="field.type === 'object' && field.properties?.length" class="esa-field__children">
        <EsaApiField
          v-for="child in field.properties"
          :key="child.name"
          :field="child"
          :site-id="siteId"
          :depth="depth + 1"
          :model-value="objectValue[child.name]"
          @update:model-value="setChild(child.name, $event)"
        />
      </div>
      <div v-else-if="field.type === 'array' && field.items?.length" class="esa-field__array">
        <div v-for="(item, index) in arrayValue" :key="index" class="esa-field__array-item">
          <div class="esa-field__array-head">
            <span>#{{ index + 1 }}</span>
            <n-button size="tiny" quaternary type="error" @click="removeItem(index)">{{ t('cdnEsaApi.removeItem') }}</n-button>
          </div>
          <EsaApiField
            v-for="child in field.items"
            :key="child.name"
            :field="child"
            :site-id="siteId"
            :depth="depth + 1"
            :model-value="item?.[child.name]"
            @update:model-value="setArrayChild(index, child.name, $event)"
          />
        </div>
        <n-button size="tiny" dashed block @click="addItem">{{ t('cdnEsaApi.addItem') }}</n-button>
      </div>
      <n-dynamic-tags
        v-else-if="field.type === 'array' && field.itemsType !== 'object'"
        :value="stringArray"
        size="small"
        @update:value="emitValue"
      />
      <n-input
        v-else-if="isJsonField"
        :value="jsonText"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 10 }"
        size="small"
        :placeholder="field.example || '{}'"
        class="mono-input"
        @update:value="setJsonText"
      />
      <n-input
        v-else-if="useTextarea"
        :value="modelValue"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 8 }"
        size="small"
        :placeholder="field.example || ''"
        class="mono-input"
        @update:value="emitValue"
      />
      <n-input
        v-else
        :value="modelValue"
        size="small"
        clearable
        :placeholder="field.example || ''"
        @update:value="emitValue"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NButton, NDynamicTags, NInput, NInputNumber, NSwitch, NTag } from 'naive-ui';
import EsaCardSelect from './EsaCardSelect.vue';
import type { EsaApiParam } from '../../lib/esaApiTypes';

const props = withDefaults(
  defineProps<{
    field: EsaApiParam;
    modelValue?: any;
    siteId?: string;
    depth?: number;
  }>(),
  { depth: 0 },
);
const emit = defineEmits<{ (e: 'update:modelValue', value: any): void }>();
const { t } = useI18n();

const isSiteId = computed(() => props.field.name === 'SiteId' && !!props.siteId);
const boolValue = computed(() => props.modelValue === true || props.modelValue === 'true' || props.modelValue === 1 || props.modelValue === '1');
const numValue = computed(() => {
  const n = Number(props.modelValue);
  return Number.isFinite(n) && props.modelValue !== '' && props.modelValue !== null && props.modelValue !== undefined ? n : null;
});
const enumOptions = computed(() => (props.field.enum || []).map((v) => ({ label: v, value: v })));
const objectValue = computed(() => (props.modelValue && typeof props.modelValue === 'object' && !Array.isArray(props.modelValue) ? props.modelValue : {}));
const arrayValue = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const stringArray = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.map((x) => String(x)) : []));
const isJsonField = computed(() => {
  const f = props.field;
  if (f.type === 'object' || f.type === 'any') return true;
  if (f.type === 'array' && f.itemsType === 'object' && !f.items?.length) return true;
  return false;
});
const jsonText = computed(() => {
  const v = props.modelValue;
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
});
const useTextarea = computed(() => {
  const f = props.field;
  if (['Rule', 'Content', 'Value', 'Expression', 'Json', 'Config', 'Data'].includes(f.name)) return true;
  return String(f.desc || '').length > 120;
});

function emitValue(value: any) {
  emit('update:modelValue', value);
}

function setChild(name: string, value: any) {
  emitValue({ ...objectValue.value, [name]: value });
}

function setArrayChild(index: number, name: string, value: any) {
  const next = arrayValue.value.map((item, i) => (i === index ? { ...(item || {}), [name]: value } : item));
  emitValue(next);
}

function setJsonText(value: string) {
  const text = String(value || '').trim();
  if (!text) return emitValue(undefined);
  try {
    emitValue(JSON.parse(text));
  } catch {
    emitValue(value);
  }
}

function addItem() {
  emitValue([...arrayValue.value, {}]);
}

function removeItem(index: number) {
  emitValue(arrayValue.value.filter((_, i) => i !== index));
}
</script>

<style scoped>
.esa-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--app-divider);
}

.esa-field--root {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  column-gap: 12px;
  padding: 0 0 12px;
  border-bottom: 1px solid var(--app-divider);
}

.esa-field--root:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.esa-field--root .esa-field__head {
  grid-column: 1;
  grid-row: 1;
  align-self: start;
  justify-content: flex-end;
  padding-top: 2px;
  color: var(--app-text-2);
  font-weight: 500;
  text-align: right;
}

.esa-field--root .esa-field__name {
  overflow-wrap: anywhere;
}

.esa-field--root .esa-field__desc {
  grid-column: 1;
  grid-row: 2;
  text-align: right;
}

.esa-field--root .esa-field__control {
  grid-column: 2;
  grid-row: 1 / span 2;
}

.esa-field--nested {
  margin-left: 10px;
  padding-left: 10px;
  border-left: 2px solid var(--app-divider);
}

.esa-field__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.esa-field__name {
  font-family: var(--app-font-mono);
}

.esa-field__required {
  color: var(--app-error);
}

.esa-field__desc {
  color: var(--app-text-3);
  font-size: 12px;
  line-height: 1.45;
}

.esa-field__control {
  min-width: 0;
  margin-top: 2px;
}

.esa-field__control :deep(.n-input),
.esa-field__control :deep(.n-select),
.esa-field__control :deep(.n-input-number) {
  width: 100%;
}

.esa-field__children {
  display: flex;
  flex-direction: column;
  padding: 2px 10px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
}

.esa-field__array {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.esa-field__array-item {
  padding: 8px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}

.esa-field__array-item:hover {
  border-color: color-mix(in srgb, var(--app-primary) 35%, var(--app-border));
  box-shadow: var(--app-shadow-sm);
}

.esa-field__array-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--app-text-3);
  font-size: 12px;
}

@media (max-width: 767px) {
  .esa-field--root {
    grid-template-columns: 1fr;
    row-gap: 4px;
  }

  .esa-field--root .esa-field__head,
  .esa-field--root .esa-field__desc,
  .esa-field--root .esa-field__control {
    grid-column: 1;
    grid-row: auto;
  }

  .esa-field--root .esa-field__head {
    justify-content: flex-start;
    text-align: left;
  }

  .esa-field--root .esa-field__desc {
    text-align: left;
  }
}
</style>
