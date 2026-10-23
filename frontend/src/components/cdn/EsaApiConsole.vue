<template>
  <div class="esa-console">
    <n-spin :show="loadBusy">
      <n-alert v-if="loadError" type="error" :show-icon="false">{{ loadError }}</n-alert>

      <div v-else-if="catalog" class="esa-console__grid">
        <aside class="esa-console__side">
          <div class="esa-console__side-head">
            <n-input v-model:value="search" size="small" clearable :placeholder="t('cdnEsaApi.search')" />
            <div class="esa-console__stats">
              <span>{{ t('cdnEsaApi.total', { n: totalActions }) }}</span>
              <span v-if="search.trim()">{{ t('cdnEsaApi.matched', { n: matchedActions }) }}</span>
            </div>
          </div>

          <n-scrollbar class="esa-console__tree">
            <div v-for="group in groups" :key="group.name" class="esa-group">
              <button class="esa-group__head" type="button" @click="toggleGroup(group.name)">
                <n-icon class="esa-group__caret" :component="expanded[group.name] ? ChevronDownOutline : ChevronForwardOutline" size="14" />
                <span class="esa-group__name">{{ group.label }}</span>
                <span class="esa-group__count">{{ group.count }}</span>
              </button>
              <div v-show="expanded[group.name]" class="esa-group__body">
                <div v-for="leaf in group.leaves" :key="leaf.key" class="esa-leaf">
                  <div class="esa-leaf__title">{{ leaf.title }}</div>
                  <button
                    v-for="action in leaf.actions"
                    :key="action"
                    type="button"
                    class="esa-action"
                    :class="{ 'esa-action--active': selectedAction === action }"
                    @click="selectAction(action)"
                  >
                    <span class="esa-action__title">{{ actionLabel(action) }}</span>
                    <span class="esa-action__name">{{ action }}</span>
                    <n-tag size="tiny" :bordered="false" :type="catalog.actions[action]?.op === 'read' ? 'info' : 'warning'">
                      {{ catalog.actions[action]?.op === 'read' ? t('cdnEsaApi.read') : t('cdnEsaApi.write') }}
                    </n-tag>
                  </button>
                </div>
              </div>
            </div>
          </n-scrollbar>
        </aside>

        <section class="esa-console__main">
          <n-empty v-if="!meta" :description="t('cdnEsaApi.selectAction')" class="esa-console__empty" />

          <template v-else>
            <div class="esa-console__head">
              <div>
                <div class="esa-console__title">{{ actionLabel(selectedAction) }}</div>
                <div class="esa-console__subtitle">
                  <span class="app-mono">{{ selectedAction }}</span>
                  <span class="esa-console__dot">·</span>
                  <span>{{ pathLabel(meta.path) }}</span>
                  <span class="esa-console__dot">·</span>
                  <span>{{ meta.method }}</span>
                  <span class="esa-console__dot">·</span>
                  <span>{{ t('cdnEsaApi.paramCount', { n: meta.params.length }) }}</span>
                </div>
              </div>
              <n-space :size="6">
                <n-tag size="small" :type="meta.op === 'read' ? 'info' : 'warning'" :bordered="false">
                  {{ meta.op === 'read' ? t('cdnEsaApi.readOnly') : t('cdnEsaApi.write') }}
                </n-tag>
                <n-tag v-if="meta.deprecated" size="small" type="error" :bordered="false">{{ t('cdnEsaApi.deprecated') }}</n-tag>
              </n-space>
            </div>

            <p v-if="meta.summary" class="esa-console__summary">{{ meta.summary }}</p>
            <n-alert v-if="meta.op !== 'read'" type="warning" :show-icon="false" class="esa-console__warning">
              {{ t('cdnEsaApi.writeWarning') }}
            </n-alert>

            <div class="esa-console__form">
              <div v-if="!meta.params.length" class="hint-text">{{ t('cdnEsaApi.noParams') }}</div>
              <EsaApiField
                v-for="field in meta.params"
                :key="field.name"
                :field="field"
                :site-id="zoneId"
                :model-value="form[field.name]"
                @update:model-value="form[field.name] = $event"
              />
            </div>

            <div class="esa-console__actions">
              <n-button type="primary" size="small" :loading="runBusy" @click="execute">{{ t('cdnEsaApi.execute') }}</n-button>
              <n-button size="small" @click="fillExample">{{ t('cdnEsaApi.fillExample') }}</n-button>
              <n-button size="small" quaternary @click="resetForm">{{ t('cdnEsaApi.reset') }}</n-button>
              <span v-if="zoneId" class="hint-text">{{ t('cdnEsaApi.siteIdAuto', { id: zoneId }) }}</span>
            </div>

            <div v-if="result !== null" class="esa-console__result">
              <div class="app-panel__head esa-console__result-head">
                <h3 class="app-panel__title">{{ t('cdnEsaApi.result') }}</h3>
                <div class="app-panel__extra">
                  <n-button size="tiny" quaternary @click="showRaw = !showRaw">{{ t('cdnEsaApi.raw') }}</n-button>
                  <n-button size="tiny" quaternary @click="copyResult">{{ t('cdnEsaApi.copy') }}</n-button>
                </div>
              </div>

              <n-tabs v-if="arrayTables.length && !showRaw" type="line" animated>
                <n-tab-pane v-for="table in arrayTables" :key="table.key" :name="table.key" :tab="`${table.key} (${table.rows.length})`">
                  <ResponsiveDataTable :columns="table.columns" :data="table.rows" size="small" :scroll-x="1200" />
                </n-tab-pane>
              </n-tabs>

              <pre v-if="showRaw || !arrayTables.length" class="code-view esa-console__json">{{ resultJson }}</pre>
            </div>
          </template>
        </section>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert, NButton, NEmpty, NIcon, NInput, NScrollbar, NSpace, NSpin, NTabPane, NTabs, NTag, useDialog, useMessage,
} from 'naive-ui';
import { ChevronDownOutline, ChevronForwardOutline } from '@vicons/ionicons5';
import { api } from '../../api';
import ResponsiveDataTable from '../ResponsiveDataTable.vue';
import EsaApiField from './EsaApiField.vue';
import type { EsaApiCatalog, EsaApiParam } from '../../lib/esaApiTypes';

const props = defineProps<{ aid: number; zoneId?: string }>();
const { t, locale } = useI18n();
const message = useMessage();
const dialog = useDialog();

interface Leaf {
  key: string;
  title: string;
  path: string[];
  actions: string[];
}

const catalog = ref<EsaApiCatalog | null>(null);
const loadBusy = ref(false);
const loadError = ref('');
const search = ref('');
const selectedAction = ref('');
const form = reactive<Record<string, any>>({});
const runBusy = ref(false);
const result = ref<any>(null);
const showRaw = ref(false);
const expanded = reactive<Record<string, boolean>>({});

const totalActions = computed(() => Object.keys(catalog.value?.actions || {}).length);
const matchedActions = computed(() => filteredLeaves.value.reduce((n, leaf) => n + leaf.actions.length, 0));
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const CATEGORY_KEYS: Record<string, string> = {
  '站点管理': 'catSite',
  '站点配置': 'catSiteConfig',
  '边缘计算': 'catEdge',
  '分析和日志': 'catAnalysis',
  '全局配置': 'catGlobal',
  '标签管理': 'catTag',
  '工具': 'catTools',
  '计费管理': 'catBilling',
  '其他': 'catOther',
};

function categoryLabel(name: string) {
  const key = CATEGORY_KEYS[name];
  return key ? t(`cdnEsaApi.${key}`) : name;
}

function actionLabel(action: string) {
  const meta = catalog.value?.actions[action];
  return isZh.value ? meta?.title || action : action;
}

function pathLabel(path: string[]) {
  return path.map((part, index) => (index === 0 ? categoryLabel(part) : part)).join(' / ');
}

function flatten(node: any, path: string[] = []): Leaf[] {
  const title = String(node?.title || '');
  const nextPath = [...path, title];
  const children = Array.isArray(node?.children) ? node.children : [];
  const direct = children.filter((c: any) => typeof c === 'string');
  const out: Leaf[] = [];
  if (direct.length) out.push({ key: nextPath.join(' / '), title, path: nextPath, actions: direct });
  for (const child of children) {
    if (child && typeof child === 'object') out.push(...flatten(child, nextPath));
  }
  return out;
}

const leaves = computed<Leaf[]>(() => (catalog.value?.directories || []).flatMap((d) => flatten(d)));

const filteredLeaves = computed<Leaf[]>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return leaves.value;
  return leaves.value
    .map((leaf) => ({
      ...leaf,
      actions: leaf.actions.filter((action) => {
        const meta = catalog.value?.actions[action];
        return (
          action.toLowerCase().includes(q) ||
          String(meta?.title || '').toLowerCase().includes(q) ||
          String(meta?.summary || '').toLowerCase().includes(q)
        );
      }),
    }))
    .filter((leaf) => leaf.actions.length);
});

const groups = computed(() => {
  const map = new Map<string, Leaf[]>();
  for (const leaf of filteredLeaves.value) {
    const name = leaf.path[0] || t('cdnEsaApi.other');
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(leaf);
  }
  return [...map.entries()].map(([name, groupLeaves]) => ({
    name,
    label: categoryLabel(name),
    leaves: groupLeaves,
    count: groupLeaves.reduce((n, leaf) => n + leaf.actions.length, 0),
  }));
});

const meta = computed(() => (selectedAction.value ? catalog.value?.actions[selectedAction.value] || null : null));

const arrayTables = computed(() => {
  const r = result.value;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return [] as any[];
  const out: any[] = [];
  for (const [key, value] of Object.entries(r)) {
    if (!Array.isArray(value) || !value.length) continue;
    const first = value.find((x) => x && typeof x === 'object' && !Array.isArray(x));
    if (!first) continue;
    const keys = [...new Set(value.slice(0, 20).flatMap((row) => (row && typeof row === 'object' ? Object.keys(row) : [])))].slice(0, 14);
    out.push({
      key,
      rows: value,
      columns: keys.map((k) => ({
        title: k,
        key: k,
        minWidth: 120,
        ellipsis: { tooltip: true },
        render: (row: any) => {
          const v = row?.[k];
          if (v === null || v === undefined) return '';
          return typeof v === 'object' ? JSON.stringify(v) : String(v);
        },
      })),
    });
  }
  return out;
});

const resultJson = computed(() => (result.value === null ? '' : JSON.stringify(result.value, null, 2)));

function toggleGroup(name: string) {
  expanded[name] = !expanded[name];
}

function resetForm() {
  for (const key of Object.keys(form)) delete form[key];
}

function selectAction(action: string) {
  selectedAction.value = action;
  resetForm();
  result.value = null;
  showRaw.value = false;
  const m = catalog.value?.actions[action];
  if (!m) return;
  for (const field of m.params) {
    if (field.name === 'SiteId' && props.zoneId) form[field.name] = props.zoneId;
    else if (field.enum?.length && field.required) form[field.name] = field.enum[0];
    else if (field.type === 'object' && field.properties?.length) form[field.name] = {};
    else if (field.type === 'array' && field.items?.length) form[field.name] = [];
  }
}

function coerceExample(field: EsaApiParam, example: string): any {
  if (field.type === 'integer' || field.type === 'number') {
    const n = Number(example);
    return Number.isFinite(n) ? n : example;
  }
  if (field.type === 'boolean') return example === 'true' || example === '1';
  if (field.type === 'object' || field.type === 'array') {
    try {
      return JSON.parse(example);
    } catch {
      return field.type === 'array' ? [] : {};
    }
  }
  return example;
}

function fillExample() {
  if (!meta.value) return;
  for (const field of meta.value.params) {
    if (field.name === 'SiteId' && props.zoneId) continue;
    if (field.example === undefined || field.example === '') continue;
    form[field.name] = coerceExample(field, field.example);
  }
}

function isEmpty(v: any): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && !v.length) return true;
  if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return true;
  return false;
}

function buildParams(): Record<string, any> {
  const out: Record<string, any> = {};
  for (const field of meta.value?.params || []) {
    const v = form[field.name];
    if (isEmpty(v)) continue;
    out[field.name] = v;
  }
  if (props.zoneId && meta.value?.params.some((p) => p.name === 'SiteId')) out.SiteId = props.zoneId;
  return out;
}

function execute() {
  if (!meta.value || !selectedAction.value) return;
  if (meta.value.op !== 'read') {
    dialog.warning({
      title: t('cdnEsaApi.confirmWriteTitle'),
      content: t('cdnEsaApi.confirmWriteContent', { action: selectedAction.value }),
      positiveText: t('cdnEsaApi.confirm'),
      negativeText: t('cdnEsaApi.cancel'),
      onPositiveClick: () => doExecute(),
    });
    return;
  }
  doExecute();
}

async function doExecute() {
  if (!meta.value || !selectedAction.value) return;
  const missing = meta.value.params
    .filter((p) => p.required && p.name !== 'SiteId' && isEmpty(form[p.name]))
    .map((p) => p.name);
  if (meta.value.params.some((p) => p.name === 'SiteId' && p.required) && !props.zoneId && isEmpty(form.SiteId)) missing.unshift('SiteId');
  if (missing.length) return message.warning(t('cdnEsaApi.missingParams', { fields: [...new Set(missing)].join(', ') }));

  runBusy.value = true;
  try {
    const res = await api<any>('POST', `/cdn/accounts/${props.aid}/esa/actions`, {
      action: selectedAction.value,
      zoneId: props.zoneId || undefined,
      params: buildParams(),
    });
    if (res.code === 0) {
      result.value = res.data;
      showRaw.value = false;
      message.success(t('cdnEsaApi.success'));
    } else {
      message.error(res.msg || t('cdnEsaApi.failed'));
    }
  } catch (e: any) {
    message.error(e?.message || t('cdnEsaApi.failed'));
  } finally {
    runBusy.value = false;
  }
}

async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultJson.value);
    message.success(t('cdnEsaApi.copied'));
  } catch {
    message.error(t('cdnEsaApi.copyFailed'));
  }
}

async function loadCatalog() {
  loadBusy.value = true;
  loadError.value = '';
  try {
    const res = await api<any>('GET', `/cdn/accounts/${props.aid}/esa/catalog`);
    if (res.code !== 0) {
      loadError.value = res.msg || t('cdnEsaApi.loadFailed');
      return;
    }
    catalog.value = res.data;
    for (const group of groups.value) expanded[group.name] = true;
    const allActions = leaves.value.flatMap((leaf) => leaf.actions);
    const first = allActions.find((action) => catalog.value?.actions[action]?.op === 'read') || allActions[0];
    if (first) selectAction(first);
  } catch (e: any) {
    loadError.value = e?.message || t('cdnEsaApi.loadFailed');
  } finally {
    loadBusy.value = false;
  }
}

watch(search, (q) => {
  if (!q.trim()) return;
  for (const group of groups.value) expanded[group.name] = true;
});

onMounted(loadCatalog);
</script>

<style scoped>
.esa-console__warning {
  margin-top: 10px;
}

.esa-console {
  min-height: 420px;
}

.esa-console__grid {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  gap: 14px;
  min-height: 620px;
}

.esa-console__side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-2);
  overflow: hidden;
}

.esa-console__side-head {
  padding: 10px;
  border-bottom: 1px solid var(--app-divider);
}

.esa-console__stats {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: var(--app-text-3);
  font-size: 12px;
}

.esa-console__tree {
  flex: 1;
  max-height: 660px;
}

.esa-group {
  border-bottom: 1px solid var(--app-divider);
}

.esa-group__head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--app-text-1);
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.esa-group__head:hover {
  background: var(--app-bg-soft);
}

.esa-group__head:focus-visible,
.esa-action:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: -2px;
}

.esa-group__caret {
  flex: 0 0 auto;
  color: var(--app-text-3);
}

.esa-group__name {
  flex: 1;
}

.esa-group__count {
  color: var(--app-text-3);
  font-size: 11px;
  font-weight: 500;
}

.esa-leaf {
  padding: 4px 8px 8px 18px;
}

.esa-leaf__title {
  margin: 4px 0;
  color: var(--app-text-3);
  font-size: 11px;
  font-weight: 600;
}

.esa-action {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 6px;
  width: 100%;
  margin: 1px 0;
  padding: 5px 6px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-text-2);
  text-align: left;
  cursor: pointer;
}

.esa-action:hover {
  background: var(--app-bg-soft);
}

.esa-action--active {
  background: var(--app-primary-weak);
  color: var(--app-primary);
}

.esa-action__title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.esa-action__name {
  grid-column: 1;
  overflow: hidden;
  color: var(--app-text-3);
  font-family: var(--app-font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.esa-action :deep(.n-tag) {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}

.esa-console__main {
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface-2);
}

.esa-console__empty {
  padding: 80px 0;
}

.esa-console__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--app-divider);
}

.esa-console__title {
  font-size: 17px;
  font-weight: 700;
}

.esa-console__subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
  color: var(--app-text-3);
  font-size: 12px;
}

.esa-console__dot {
  opacity: 0.5;
}

.esa-console__summary {
  margin: 10px 0 0;
  color: var(--app-text-2);
  font-size: 13px;
  line-height: 1.6;
}

.esa-console__form {
  margin-top: 6px;
}

.esa-console__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--app-divider);
}

.esa-console__result {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--app-divider);
}

.esa-console__result-head {
  margin-bottom: 8px;
}

.esa-console__json {
  max-height: 460px;
  margin: 0;
  overflow: auto;
}

@media (max-width: 900px) {
  .esa-console__grid {
    grid-template-columns: 1fr;
  }

  .esa-console__tree {
    max-height: 280px;
  }
}
</style>
