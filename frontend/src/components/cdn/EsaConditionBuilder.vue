<template>
  <div class="esa-cond">
    <div class="esa-cond__toolbar">
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button value="visual">{{ L('可视化编辑', 'Visual') }}</n-radio-button>
        <n-radio-button value="expr">{{ L('表达式编辑', 'Expression') }}</n-radio-button>
      </n-radio-group>
      <span class="esa-cond__hint">{{ L('组内条件为「且」，组与组之间为「或」。', 'Conditions inside a group are AND; groups are OR.') }}</span>
    </div>

    <template v-if="mode === 'visual'">
      <div v-for="(grp, gi) in groups" :key="gi" class="esa-cond__group">
        <div v-if="gi > 0" class="esa-cond__or">{{ L('或 (Or)', 'Or') }}</div>
        <div class="esa-cond__group-head">
          <span class="esa-cond__group-title">{{ L(`条件组 ${gi + 1}`, `Group ${gi + 1}`) }}</span>
          <n-button v-if="groups.length > 1" size="tiny" type="error" quaternary @click="removeGroup(gi)">
            {{ L('删除组', 'Remove group') }}
          </n-button>
        </div>

        <div v-for="(it, ii) in grp.items" :key="ii" class="esa-cond__row">
          <EsaCardSelect
            v-model="it.field"
            :options="fieldOptions"
            searchable
            dense
            class="esa-cond__field"
            @update:model-value="(v: string) => applyField(it, v)"
          />
          <EsaCardSelect
            v-model="it.operator"
            :options="operatorOptionsOf(it.field)"
            searchable
            dense
            class="esa-cond__op"
            @update:model-value="(v: string) => (it.operator = v)"
          />
          <n-input
            v-if="needName(it.field)"
            v-model:value="it.name"
            size="small"
            :placeholder="namePlaceholder(it.field)"
            class="esa-cond__name"
          />
          <EsaCardSelect
            v-if="isBoolField(it.field) && !isListOp(it.operator)"
            v-model="it.values[0]"
            :options="boolOptions"
            compact
            class="esa-cond__value"
          />
          <n-dynamic-tags
            v-else-if="!isSingle(it.operator)"
            v-model:value="it.values"
            size="small"
            class="esa-cond__value"
          />
          <n-input
            v-else
            v-model:value="it.values[0]"
            size="small"
            :placeholder="valuePlaceholder(it.field)"
            class="esa-cond__value"
          />
          <n-button size="tiny" type="error" quaternary @click="removeItem(gi, ii)">{{ L('删除', 'Remove') }}</n-button>
        </div>

        <div class="esa-cond__group-actions">
          <n-button size="tiny" @click="addItem(gi)">{{ L('添加条件', 'Add condition') }}</n-button>
          <n-button size="tiny" @click="addGroup">{{ L('添加「或」组', 'Add OR group') }}</n-button>
        </div>
      </div>

      <div v-if="!groups.length" class="esa-cond__empty">{{ L('未添加条件，将匹配全部请求。', 'No condition: matches all requests.') }}</div>
    </template>

    <template v-else>
      <n-input
        v-model:value="exprText"
        type="textarea"
        :rows="3"
        class="mono-input"
        spellcheck="false"
        :placeholder="L('例如：(http.host eq &quot;www.example.com&quot;)', 'e.g. (http.host eq &quot;www.example.com&quot;)')"
        @update:value="onExprInput"
      />
      <div class="esa-cond__expr-actions">
        <n-button size="tiny" @click="toVisual">{{ L('使用可视化编辑', 'Use visual builder') }}</n-button>
        <span v-if="parseFailed" class="esa-cond__warn">{{ L('当前表达式无法完全还原为可视化条件，已保留原始表达式。', 'This expression cannot be fully restored visually; the raw expression is kept.') }}</span>
      </div>
    </template>

    <div class="esa-cond__preview">
      <span class="esa-cond__preview-label">{{ L('表达式预览', 'Expression preview') }}</span>
      <code class="esa-cond__preview-code">{{ built }}</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NDynamicTags, NInput, NRadioButton, NRadioGroup } from 'naive-ui';
import EsaCardSelect, { type EsaCardOption } from './EsaCardSelect.vue';

import {
  ESA_MATCH_FIELDS,
  ESA_OPERATORS,
  esaGateLabel,
  type EsaMatchField,
} from '../../lib/esaRuleMeta';
import {
  buildEsaExpression,
  esaNeedName,
  esaSingleValue,
  newEsaCondItem,
  newEsaOrGroup,
  parseEsaExpression,
  type EsaCondItem,
  type EsaOrGroup,
} from '../../lib/esaRuleExpr';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    domains?: string[];
    locale?: 'zh' | 'en';
  }>(),
  { modelValue: '', domains: () => [], locale: 'zh' },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const locale = computed(() => props.locale);
const L = (zh: string, en: string) => (locale.value === 'zh' ? zh : en);

const mode = ref<'visual' | 'expr'>('visual');
const exprText = ref('');
const parseFailed = ref(false);
const groups = ref<EsaOrGroup[]>([]);

function initFrom(value: string) {
  exprText.value = value || '';
  if (!value || value === 'true') {
    // 自定义条件下默认给出一行空条件，用户可直接选择字段/运算符
    groups.value = [newEsaOrGroup()];
    parseFailed.value = false;
    return;
  }
  const parsed = parseEsaExpression(value);
  if (parsed) {
    groups.value = parsed.length ? parsed : [];
    parseFailed.value = false;
  } else {
    groups.value = [];
    parseFailed.value = true;
    mode.value = 'expr';
  }
}
initFrom(props.modelValue || '');

watch(
  () => props.modelValue,
  (v) => {
    if ((v || '') !== built.value && (v || '') !== exprText.value) initFrom(v || '');
  },
);

const built = computed(() => (mode.value === 'expr' ? exprText.value : buildEsaExpression(groups.value)));

watch(built, (v) => emit('update:modelValue', v));

// 切换编辑模式：进入表达式模式时带出当前可视化结果；回到可视化时尝试解析表达式
watch(mode, (m) => {
  if (m === 'expr') {
    exprText.value = buildEsaExpression(groups.value);
    return;
  }
  const parsed = parseEsaExpression(exprText.value);
  if (parsed) {
    groups.value = parsed.length ? parsed : [newEsaOrGroup()];
    parseFailed.value = false;
  } else {
    parseFailed.value = true;
    mode.value = 'expr';
  }
});

// ---------- 选项 ----------
const fieldOptions = computed<EsaCardOption[]>(() =>
  ESA_MATCH_FIELDS.map((f) => {
    const gate = esaGateLabel(f.gate, locale.value);
    return {
      value: f.value,
      label: locale.value === 'zh' ? f.label.zh : f.label.en,
      desc: (gate ? `【${gate}】` : '') + (locale.value === 'zh' ? f.desc.zh : f.desc.en),
    };
  }),
);

function operatorOptionsOf(fieldValue: string): EsaCardOption[] {
  const field = ESA_MATCH_FIELDS.find((f) => f.value === fieldValue);
  const bool = field?.valueKind === 'bool';
  return ESA_OPERATORS.filter((o) => (bool ? ['eq', 'ne'].includes(o.value) : true)).map((o) => {
    const gate = esaGateLabel(o.gate, locale.value);
    return {
      value: o.value,
      label: locale.value === 'zh' ? o.label.zh : o.label.en,
      desc: (gate ? `【${gate}】` : '') + (locale.value === 'zh' ? o.desc.zh : o.desc.en),
    };
  });
}

const boolOptions = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
];

// ---------- 操作 ----------
function isListOp(op: string) {
  return ['in', 'not_in', 'in_list', 'not_in_list'].includes(op);
}
function isSingle(op: string) {
  return esaSingleValue(op);
}
function needName(field: string) {
  return esaNeedName(ESA_MATCH_FIELDS.find((f) => f.value === field));
}
function isBoolField(field: string) {
  return ESA_MATCH_FIELDS.find((f) => f.value === field)?.valueKind === 'bool';
}
function namePlaceholder(field: string) {
  if (field === 'http.cookie') return L('Cookie 名称', 'Cookie name');
  if (field === 'http.request.uri.args') return L('查询参数名', 'Query parameter name');
  return L('请求头名称', 'Header name');
}
function valuePlaceholder(field: string) {
  const meta: EsaMatchField | undefined = ESA_MATCH_FIELDS.find((f) => f.value === field);
  switch (meta?.valueKind) {
    case 'ip':
      return '1.2.3.4 / 2001:db8::1';
    case 'country':
      return 'CN / US';
    case 'number':
      return '123';
    case 'regex':
      return '^/api/.*';
    default:
      return L('输入取值', 'Enter a value');
  }
}

function applyField(it: EsaCondItem, field: string) {
  it.field = field;
  // 布尔字段收敛为 equals；列表运算符保持不变
  if (isBoolField(field) && !isListOp(it.operator)) {
    it.operator = 'eq';
    it.values = ['true'];
  }
  if (!needName(field)) it.name = '';
}

function addItem(gi: number) {
  groups.value[gi].items.push(newEsaCondItem());
}
function removeItem(gi: number, ii: number) {
  groups.value[gi].items.splice(ii, 1);
  if (!groups.value[gi].items.length) groups.value.splice(gi, 1);
}
function addGroup() {
  groups.value.push(newEsaOrGroup());
}
function removeGroup(gi: number) {
  groups.value.splice(gi, 1);
}

function onExprInput(v: string) {
  exprText.value = v;
}
function toVisual() {
  const parsed = parseEsaExpression(exprText.value);
  if (parsed) {
    groups.value = parsed;
    parseFailed.value = false;
    mode.value = 'visual';
  } else {
    parseFailed.value = true;
  }
}
</script>

<style scoped>
.esa-cond {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.esa-cond__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.esa-cond__hint {
  font-size: 12px;
  color: var(--app-text-3);
}
.esa-cond__group {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  padding: 10px 12px;
  background: var(--app-surface-2);
}
.esa-cond__or {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-3);
}
.esa-cond__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.esa-cond__group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--app-text-2);
}
.esa-cond__row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(130px, 0.9fr) minmax(0, 1.6fr) auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.esa-cond__name {
  grid-column: 1 / 2;
}
.esa-cond__value {
  grid-column: 3 / 4;
}
.esa-cond__group-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.esa-cond__empty {
  padding: 12px;
  font-size: 12px;
  color: var(--app-text-3);
  border: 1px dashed var(--app-divider);
  border-radius: var(--app-radius-md);
}
.esa-cond__expr-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.esa-cond__warn {
  font-size: 12px;
  color: var(--app-warning);
}
.esa-cond__preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-md);
  background: var(--app-bg-soft);
}
.esa-cond__preview-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--app-text-3);
}
.esa-cond__preview-code {
  font-family: var(--app-font-mono);
  font-size: 12px;
  color: var(--app-text-1);
  word-break: break-all;
}
@media (max-width: 767px) {
  .esa-cond__row {
    grid-template-columns: 1fr;
  }
  .esa-cond__name,
  .esa-cond__value {
    grid-column: auto;
  }
}
</style>
