<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <h3 class="app-panel__title">
        {{ title }}
        <n-tag v-if="gate" size="tiny" :bordered="false" type="warning" style="margin-left: 6px">{{ gate }}</n-tag>
      </h3>
      <div class="app-panel__extra">
        <n-button size="small" :loading="loadBusy" :disabled="loadBusy" @click="load">{{ t('esaZone.reload') }}</n-button>
        <n-button v-if="saveAction" size="small" type="primary" :loading="saveBusy" :disabled="saveBusy" @click="save">
          {{ t('esaZone.save') }}
        </n-button>
      </div>
    </div>
    <p v-if="desc" class="hint-text mb-3">{{ desc }}</p>

    <n-alert v-if="loadError" type="error" :show-icon="false" class="mb-3">{{ loadError }}</n-alert>

    <n-spin :show="loadBusy">
      <n-form v-if="fields.length" label-placement="left" label-width="150" size="small">
        <n-form-item v-for="f in fields" :key="f.name" :label="f.label" :required="f.required">
          <div class="esa-panel__field">
            <EsaCardSelect
              v-if="f.type === 'select'"
              v-model="form[f.name]"
              :options="f.options || []"
              :placeholder="f.placeholder"
              compact
              clearable
            />
            <EsaCardSelect
              v-else-if="f.type === 'cards'"
              v-model="form[f.name]"
              :options="f.options || []"
              :placeholder="f.placeholder"
            />
            <n-switch v-else-if="f.type === 'switch'" v-model:value="form[f.name]" size="small" />
            <n-switch v-else-if="f.type === 'onoff'" v-model:value="form[f.name]" size="small" />
            <n-input-number
              v-else-if="f.type === 'number' || f.type === 'stringnumber'"
              v-model:value="form[f.name]"
              :min="f.min"
              :max="f.max"
              :step="f.step"
              :placeholder="f.placeholder"
              style="width: 220px"
            />
            <n-input
              v-else-if="f.type === 'textarea'"
              v-model:value="form[f.name]"
              type="textarea"
              :rows="4"
              :placeholder="f.placeholder"
            />
            <n-input
              v-else-if="f.type === 'json'"
              v-model:value="form[f.name]"
              type="textarea"
              :rows="7"
              :placeholder="f.placeholder || 'JSON'"
              class="mono-input"
              spellcheck="false"
            />
            <EsaRowsEditor
              v-else-if="f.type === 'rows'"
              v-model="form[f.name]"
              :fields="f.rowFields || []"
              :default-row="f.defaultRow"
              :add-label="f.addLabel"
            />
            <n-input v-else v-model:value="form[f.name]" :placeholder="f.placeholder" style="width: 100%" />
            <span v-if="f.help" class="esa-panel__help">{{ f.help }}</span>
          </div>
        </n-form-item>
      </n-form>

      <div v-else class="esa-panel__raw">
        <n-input
          v-model:value="rawText"
          type="textarea"
          :rows="12"
          class="mono-input"
          spellcheck="false"
          :placeholder="t('esaZone.rawHint')"
        />
      </div>
    </n-spin>

    <div class="esa-panel__foot">
      <n-button text size="tiny" @click="showRaw = !showRaw">
        {{ showRaw ? t('esaZone.hideRaw') : t('esaZone.showRaw') }}
      </n-button>
    </div>
    <pre v-if="showRaw && rawText" class="code-view">{{ prettyRaw }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMessage, NAlert, NButton, NForm, NFormItem, NInput, NInputNumber, NSpin, NSwitch, NTag } from 'naive-ui';
import { api } from '../../api';
import EsaCardSelect from './EsaCardSelect.vue';
import EsaRowsEditor, { type EsaRowFieldDef } from './EsaRowsEditor.vue';

export interface EsaFieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'stringnumber' | 'switch' | 'onoff' | 'select' | 'cards' | 'textarea' | 'json' | 'rows';
  options?: { label: string; value: any; desc?: string }[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
  default?: any;
  required?: boolean;
  rowFields?: EsaRowFieldDef[];
  defaultRow?: Record<string, any>;
  addLabel?: string;
}

const props = withDefaults(
  defineProps<{
    aid: number;
    zoneId: string;
    title: string;
    desc?: string;
    loadAction: string;
    loadParams?: Record<string, any>;
    valuePath?: string;
    saveAction?: string;
    fields?: EsaFieldDef[];
    buildSave?: (form: Record<string, any>) => Record<string, any>;
    gate?: string;
    autoLoad?: boolean;
    stripKeys?: string[];
  }>(),
  { fields: () => [], autoLoad: true, stripKeys: () => ['RequestId'] },
);

const emit = defineEmits<{ (e: 'saved', data: any): void }>();

const { t } = useI18n();
const message = useMessage();

const form = reactive<Record<string, any>>({});
const rawText = ref('');
const rawSource = ref<any>(null);
const loadBusy = ref(false);
const saveBusy = ref(false);
const loadError = ref('');
const showRaw = ref(false);

const prettyRaw = computed(() => {
  try {
    return JSON.stringify(rawSource.value, null, 2);
  } catch {
    return String(rawSource.value ?? '');
  }
});

function getPath(obj: any, path?: string): any {
  if (!path) return obj;
  return String(path)
    .split('.')
    .filter(Boolean)
    .reduce((acc: any, key) => (acc == null ? acc : acc[key]), obj);
}

function parseMaybeJson(v: any): any {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s || (s[0] !== '{' && s[0] !== '[')) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function resetForm() {
  for (const f of props.fields) {
    if (f.type === 'rows') form[f.name] = [];
    else if (f.type === 'stringnumber') form[f.name] = f.default === undefined || f.default === null || f.default === '' ? null : Number(f.default);
    else form[f.name] = f.type === 'onoff' || f.type === 'switch' ? Boolean(f.default) : f.default ?? null;
  }
}

function hydrate(src: any) {
  let value = parseMaybeJson(src);
  if (props.valuePath) value = parseMaybeJson(getPath(value, props.valuePath));
  rawSource.value = value;
  rawText.value = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? '');
  resetForm();
  if (value && typeof value === 'object') {
    for (const f of props.fields) {
      const v = value[f.name];
      if (v === undefined || v === null) continue;
      if (f.type === 'onoff') form[f.name] = v === 'on' || v === true;
      else if (f.type === 'switch') form[f.name] = v === true || v === 'on';
      else if (f.type === 'json') form[f.name] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      else if (f.type === 'stringnumber') form[f.name] = v === '' ? null : Number(v);
      else if (f.type === 'rows') form[f.name] = typeof v === 'string' ? parseMaybeJson(v) : Array.isArray(v) ? v : [];
      else form[f.name] = v;
    }
  }
}

async function load() {
  if (!props.loadAction) return;
  loadBusy.value = true;
  loadError.value = '';
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: props.loadAction,
      zoneId: props.zoneId,
      params: { ...(props.loadParams || {}) },
    });
    if (res.code !== 0) {
      loadError.value = res.msg || t('esaZone.loadFailed');
      return;
    }
    hydrate(res.data);
  } catch (e: any) {
    loadError.value = e?.message || t('esaZone.loadFailed');
  } finally {
    loadBusy.value = false;
  }
}

function buildPayload(): Record<string, any> | null {
  if (!props.fields.length) {
    const text = rawText.value.trim();
    if (!text) return {};
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      for (const key of props.stripKeys) delete parsed[key];
      return parsed;
    } catch {
      message.warning(t('esaZone.invalidJson'));
      return null;
    }
  }
  const out: Record<string, any> = {};
  for (const f of props.fields) {
    let v = form[f.name];
    if (f.type === 'onoff') v = v ? 'on' : 'off';
    else if (f.type === 'switch') v = Boolean(v);
    else if (f.type === 'number') v = v === null || v === '' ? undefined : Number(v);
    else if (f.type === 'stringnumber') v = v === null || v === '' ? undefined : String(v);
    else if (f.type === 'rows') {
      v = Array.isArray(v) ? v : undefined;
      if (v) v = v.filter((row: any) => row && Object.values(row).some((x) => x !== '' && x !== null && x !== undefined));
    } else if (f.type === 'json') {
      if (v === null || v === undefined || v === '') v = undefined;
      else {
        try {
          v = JSON.parse(String(v));
        } catch {
          message.warning(t('esaZone.invalidJsonField', { field: f.label }));
          return null;
        }
      }
    }
    if (v !== undefined && v !== null && v !== '') out[f.name] = v;
  }
  return { ...out, ...(props.buildSave ? props.buildSave(out) : {}) };
}

async function save() {
  if (!props.saveAction) return;
  const payload = buildPayload();
  if (payload === null) return;
  saveBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: props.saveAction,
      zoneId: props.zoneId,
      params: payload,
    });
    if (res.code === 0) {
      message.success(t('esaZone.saved'));
      emit('saved', res.data);
      await load();
    } else {
      message.error(res.msg || t('esaZone.saveFailed'));
    }
  } catch (e: any) {
    message.error(e?.message || t('esaZone.saveFailed'));
  } finally {
    saveBusy.value = false;
  }
}

onMounted(() => {
  if (props.autoLoad) load();
});

defineExpose({ load });
</script>

<style scoped>
.esa-panel__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.esa-panel__help {
  font-size: 11px;
  color: var(--app-text-3);
}

.esa-panel__raw {
  width: 100%;
}

.esa-panel__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}
</style>
