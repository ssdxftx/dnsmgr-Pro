<template>
  <div class="rule-editor">
    <!-- 模式切换 + 操作条 -->
    <div class="rule-editor__bar">
      <n-radio-group v-model:value="mode" size="small">
        <n-radio-button value="visual">{{ t('cdnRules.modeVisual') }}</n-radio-button>
        <n-radio-button value="json">{{ t('cdnRules.modeJson') }}</n-radio-button>
      </n-radio-group>
      <n-space :size="8">
        <n-button v-if="editing" size="small" @click="emit('cancel')">{{ t('common.cancel') }}</n-button>
        <n-button size="small" type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
      </n-space>
    </div>

    <!-- ============ 可视化模式 ============ -->
    <template v-if="mode === 'visual'">
      <div class="zone-panel">
        <div class="zone-panel__head">
          <h3 class="zone-panel__title">{{ t('cdnRules.groupCommon') }}</h3>
        </div>
        <n-form label-placement="left" label-width="132">
          <n-form-item :label="t('cdnRules.ruleName')" required>
            <n-input v-model:value="form.ruleName" :placeholder="t('cdnRules.ruleName')" />
          </n-form-item>
          <n-form-item :label="t('cdnRules.colEnable')">
            <n-switch v-model:value="form.enabled" size="small" />
          </n-form-item>

          <!-- ESA：条件表达式 + 片段插入 -->
          <template v-if="isEsa">
            <n-form-item :label="t('cdnRules.condTitle')">
              <n-radio-group v-model:value="esaCondMode" size="small">
                <n-radio-button value="all">{{ t('cdnRules.condAll') }}</n-radio-button>
                <n-radio-button value="custom">{{ t('cdnRules.condCustom') }}</n-radio-button>
              </n-radio-group>
            </n-form-item>
            <n-form-item v-if="esaCondMode === 'all'" :label="' '">
              <span class="hint-text">{{ t('cdnRules.condAllHint') }}</span>
            </n-form-item>
            <template v-else>
              <n-form-item :label="t('cdnRules.condExpression')">
                <n-input
                  v-model:value="form.ruleExpr"
                  type="textarea"
                  :rows="2"
                  :placeholder="t('cdnRules.condExpressionHint')"
                  class="mono-input"
                  spellcheck="false"
                />
              </n-form-item>
              <n-form-item :label="t('cdnRules.condSnippet')">
                <n-space :size="6">
                  <n-button v-for="s in esaSnippets" :key="s.key" size="tiny" @click="insertSnippet(s.tpl)">
                    {{ t(s.key) }}
                  </n-button>
                </n-space>
              </n-form-item>
            </template>
            <n-form-item :label="t('cdnRules.colSeq')">
              <n-input-number v-model:value="form.sequence" :min="0" style="width: 160px" clearable />
            </n-form-item>
          </template>
        </n-form>
      </div>

      <!-- ESA：行为字段（由官方字段表驱动） -->
      <div v-if="isEsa" class="zone-panel">
        <div class="zone-panel__head">
          <h3 class="zone-panel__title">{{ t('cdnRules.groupAction') }}</h3>
        </div>
        <n-form label-placement="left" label-width="132">
          <n-form-item
            v-for="f in esaActionFields"
            :key="f.name"
            :label="labelOf(f)"
            :required="!!f.required"
            :label-props="f.desc ? { title: f.desc } : undefined"
          >
            <RuleFieldControl :field="f" v-model="form.data[f.name]" />
          </n-form-item>
          <div v-if="!esaActionFields.length" class="hint-text">{{ t('cdnRules.empty') }}</div>
        </n-form>
      </div>

      <!-- EO：条件树 + 动作列表（由 DescribeRulesSetting 驱动） -->
      <template v-else>
        <div class="zone-panel">
          <div class="zone-panel__head">
            <h3 class="zone-panel__title">{{ t('cdnRules.condTitle') }}</h3>
          </div>
          <div v-for="(grp, gi) in form.eoConditions" :key="gi" class="rule-editor__group">
            <div class="rule-editor__group-head">
              <span class="rule-editor__group-badge tnum">{{ gi + 1 }}</span>
              <span class="rule-editor__group-title">{{ t('cdnRules.condGroupTitle', { index: gi + 1 }) }}</span>
              <span class="hint-text">{{ t('cdnRules.condGroupHint') }}</span>
              <n-space :size="6" style="margin-left: auto">
                <n-button size="tiny" @click="addEoCondition(gi)">{{ t('cdnRules.condAddItem') }}</n-button>
                <n-button v-if="form.eoConditions.length > 1" size="tiny" type="error" quaternary @click="removeEoGroup(gi)">
                  {{ t('cdnRules.condRemoveGroup') }}
                </n-button>
              </n-space>
            </div>
            <div class="rule-editor__cond-list">
              <div v-for="(it, ii) in grp.items" :key="ii" class="rule-editor__cond-row">
                <n-select
                  v-model:value="it.target"
                  :options="targetOptions"
                  :placeholder="t('cdnRules.condTarget')"
                  size="small"
                  class="rule-editor__cond-target"
                />
                <n-select
                  v-model:value="it.operator"
                  :options="operatorOptions"
                  size="small"
                  class="rule-editor__cond-op"
                />
                <n-dynamic-tags
                  v-if="!noValueOperator(it.operator)"
                  v-model:value="it.values"
                  size="small"
                  class="rule-editor__cond-values"
                />
                <n-tag v-else size="small" :bordered="false">{{ t('cdnRules.condNoValue') }}</n-tag>
                <n-button size="tiny" type="error" quaternary circle @click="removeEoCondition(gi, ii)">
                  <template #icon><n-icon :component="CloseOutline" /></template>
                </n-button>
              </div>
            </div>
          </div>
          <n-button size="small" dashed block style="margin-top: 8px" @click="addEoGroup">
            {{ t('cdnRules.condAddGroup') }}
          </n-button>
        </div>

        <div class="zone-panel">
          <div class="zone-panel__head">
            <h3 class="zone-panel__title">{{ t('cdnRules.actionTitle') }}</h3>
          </div>
          <div v-for="(a, ai) in form.eoActions" :key="ai" class="rule-editor__group">
            <div class="rule-editor__group-head">
              <n-select
                v-model:value="a.action"
                :options="actionOptions"
                :placeholder="t('cdnRules.actionPick')"
                size="small"
                filterable
                style="min-width: 300px"
                @update:value="() => onActionChange(a)"
              />
              <n-button size="tiny" type="error" quaternary style="margin-left: auto" @click="form.eoActions.splice(ai, 1)">
                {{ t('cdnRules.actionRemove') }}
              </n-button>
            </div>
            <div v-if="propertiesOf(a.action).length" class="rule-editor__params">
              <n-form label-placement="left" label-width="132">
                <n-form-item
                  v-for="p in propertiesOf(a.action)"
                  :key="p.Name"
                  :label="p.Name"
                  :label-props="p.Description ? { title: p.Description } : undefined"
                >
                  <n-select
                    v-if="p.Type === 'CHOICE'"
                    :value="a.params[p.Name] ?? null"
                    :options="(p.ChoicesValue || []).map((c: any) => ({ label: String(c), value: String(c) }))"
                    size="small"
                    clearable
                    @update:value="(v: any) => (a.params[p.Name] = v)"
                  />
                  <n-switch
                    v-else-if="p.Type === 'TOGGLE'"
                    :value="toEnabled(a.params[p.Name])"
                    size="small"
                    @update:value="(v: boolean) => (a.params[p.Name] = pickToggle(p, v))"
                  />
                  <n-input-number
                    v-else-if="p.Type === 'CUSTOM_NUM'"
                    :value="numOrNull(a.params[p.Name])"
                    :min="p.Min || undefined"
                    :max="p.Max || undefined"
                    size="small"
                    clearable
                    style="width: 100%"
                    @update:value="(v: any) => (a.params[p.Name] = v)"
                  />
                  <n-dynamic-tags
                    v-else-if="p.IsMultiple"
                    :value="Array.isArray(a.params[p.Name]) ? a.params[p.Name] : []"
                    size="small"
                    @update:value="(v: any) => (a.params[p.Name] = v)"
                  />
                  <n-input
                    v-else
                    :value="a.params[p.Name] === undefined || a.params[p.Name] === null ? '' : String(a.params[p.Name])"
                    size="small"
                    @update:value="(v: string) => (a.params[p.Name] = v)"
                  />
                </n-form-item>
              </n-form>
            </div>
          </div>
          <n-button size="small" dashed block style="margin-top: 8px" @click="addEoAction">
            {{ t('cdnRules.actionAdd') }}
          </n-button>
        </div>
      </template>
    </template>

    <!-- ============ JSON 源码模式 ============ -->
    <template v-else>
      <n-alert type="info" :show-icon="false" style="margin-bottom: 10px">{{ t('cdnRules.modeJsonHint') }}</n-alert>
      <n-input v-model:value="jsonText" type="textarea" :rows="16" spellcheck="false" class="mono-input" />
      <n-space justify="end" style="margin-top: 10px">
        <n-button size="small" @click="syncFromJson">{{ t('cdnRules.modeVisual') }}</n-button>
      </n-space>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert, NButton, NDynamicTags, NForm, NFormItem, NIcon, NInput, NInputNumber,
  NRadioButton, NRadioGroup, NSelect, NSpace, NSwitch, NTag,
} from 'naive-ui';
import { CloseOutline } from '@vicons/ionicons5';
import RuleFieldControl from './RuleFieldControl.vue';
import { toEnabled } from '../../lib/cdnSwitch';

const props = defineProps<{
  vendor: 'esa' | 'eo';
  /** ESA：规则字段表；EO：{ actions, condition } */
  schema: any;
  /** 编辑既有规则时的初始数据 */
  initial?: any;
  editing?: boolean;
  saving?: boolean;
}>();
const emit = defineEmits<{
  (e: 'save', payload: Record<string, any>): void;
  (e: 'cancel'): void;
}>();

const { t, te, locale } = useI18n();
const isEsa = computed(() => props.vendor === 'esa');
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));

const mode = ref<'visual' | 'json'>('visual');
const jsonText = ref('');

const form = reactive<any>({
  ruleName: '',
  enabled: true,
  ruleExpr: '',
  sequence: null,
  data: {} as Record<string, any>,
  eoConditions: [{ items: [{ target: 'url', operator: 'equal', values: [] }] }] as any[],
  eoActions: [{ action: '', params: {} as Record<string, any> }] as any[],
});
const esaCondMode = ref<'all' | 'custom'>('custom');

// ---------- 标签 ----------
function labelOf(f: any): string {
  const key = `cdnRules.f.${f.name}`;
  if (te(key)) return t(key);
  if (f.label && isZh.value) return f.label;
  return f.name;
}

// ---------- ESA ----------
const esaFields = computed<any[]>(() => (isEsa.value && Array.isArray(props.schema) ? props.schema : []));
const esaActionFields = computed(() => esaFields.value.filter((f) => f.group !== 'common'));

const esaSnippets = [
  { key: 'cdnRules.condSnippetHost', tpl: '(http.host eq "example.com")' },
  { key: 'cdnRules.condSnippetPath', tpl: '(starts_with(http.request.uri.path, "/"))' },
  { key: 'cdnRules.condSnippetExt', tpl: '(http.request.uri.path matches "\\.(jpg|png)$")' },
  { key: 'cdnRules.condSnippetMethod', tpl: '(http.request.method eq "GET")' },
];
function insertSnippet(tpl: string) {
  const cur = String(form.ruleExpr || '').trim();
  if (!cur || cur === 'true') form.ruleExpr = tpl;
  else form.ruleExpr = cur + ' and ' + tpl.replace(/^\(/, '').replace(/\)$/, '');
}

// ---------- EO 元数据 ----------
const eoActions = computed<any[]>(() => (Array.isArray(props.schema?.actions) ? props.schema.actions : []));
const actionOptions = computed(() => eoActions.value.map((a: any) => ({ label: a.Action, value: a.Action })));
const conditionSchema = computed(() => props.schema?.condition || {});
const operatorOptions = computed(() =>
  (conditionSchema.value.operators || []).map((o: string) => ({ label: o, value: o })),
);
const targetOptions = computed(() =>
  (conditionSchema.value.targets || []).map((o: string) => ({ label: o, value: o })),
);
function noValueOperator(op: string) {
  return (conditionSchema.value.valueOptionalOperators || []).includes(op);
}
function propertiesOf(action: string): any[] {
  const hit = eoActions.value.find((a: any) => a.Action === action);
  return Array.isArray(hit?.Properties) ? hit.Properties : [];
}
function numOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pickToggle(p: any, on: boolean) {
  const choices: string[] = Array.isArray(p.ChoicesValue) ? p.ChoicesValue : ['on', 'off'];
  const onVal = choices.find((c) => toEnabled(c)) ?? choices[0] ?? 'on';
  const offVal = choices.find((c) => !toEnabled(c)) ?? choices[1] ?? 'off';
  return on ? onVal : offVal;
}
function onActionChange(a: any) {
  a.params = {};
}
function addEoGroup() {
  form.eoConditions.push({ items: [{ target: 'url', operator: 'equal', values: [] }] });
}
function removeEoGroup(gi: number) {
  form.eoConditions.splice(gi, 1);
}
function addEoCondition(gi: number) {
  form.eoConditions[gi].items.push({ target: 'url', operator: 'equal', values: [] });
}
function removeEoCondition(gi: number, ii: number) {
  const g = form.eoConditions[gi];
  g.items.splice(ii, 1);
  if (!g.items.length) form.eoConditions.splice(gi, 1);
  if (!form.eoConditions.length) addEoGroup();
}
function addEoAction() {
  form.eoActions.push({ action: '', params: {} });
}

// ---------- 初始化 / payload 组装 ----------
/** ESA payload：直接就是 Create/Update{Kind} 的字段对象（不含 SiteId/Action，由后端补齐） */
function buildEsaPayload(): Record<string, any> {
  const out: Record<string, any> = {};
  if (form.ruleName) out.RuleName = form.ruleName;
  out.RuleEnable = form.enabled ? 'on' : 'off';
  if (esaCondMode.value === 'all') out.Rule = 'true';
  else if (String(form.ruleExpr || '').trim()) out.Rule = String(form.ruleExpr).trim();
  if (form.sequence !== null && form.sequence !== undefined && form.sequence !== '') out.Sequence = Number(form.sequence);
  for (const f of esaActionFields.value) {
    const v = form.data[f.name];
    if (v === undefined || v === null || v === '') continue;
    out[f.name] = f.type === 'number' ? Number(v) : v;
  }
  return out;
}

/** EO payload：{ RuleName, Status, Rules:[{Conditions,Actions}] } */
function buildEoPayload(): Record<string, any> {
  const groups = form.eoConditions
    .map((g: any) => ({
      Conditions: (g.items || [])
        .filter((it: any) => it && it.target && it.operator)
        .map((it: any) => ({
          Target: it.target,
          Operator: it.operator,
          Values: noValueOperator(it.operator) ? [] : (Array.isArray(it.values) ? it.values : []),
        })),
    }))
    .filter((g: any) => g.Conditions.length);

  const actions = form.eoActions
    .filter((a: any) => a.action)
    .map((a: any) => {
      const props = propertiesOf(a.action);
      const params = props.map((p: any) => {
        const raw = a.params[p.Name];
        const extraId = p.ExtraParameter?.Id;
        const values = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : [raw];
        const item: Record<string, any> = {};
        if (extraId === 'Action') item.Action = String(raw ?? '');
        if (extraId === 'StatusCode') item.StatusCode = Number(raw ?? 0);
        item.Name = p.Name;
        item.Values = values;
        return item;
      });
      // 依据属性的 ExtraParameter.Id 判定动作类型（官方：无额外参数 → NormalAction）
      const kindOf = props.find((p: any) => p.ExtraParameter?.Id)?.ExtraParameter?.Id;
      if (kindOf === 'Action') return { RewriteAction: { Action: a.action, Parameters: params } };
      if (kindOf === 'StatusCode') return { CodeAction: { Action: a.action, Parameters: params } };
      return { NormalAction: { Action: a.action, Parameters: params } };
    });

  const rule: Record<string, any> = {};
  if (groups.length) rule.Conditions = groups;
  if (actions.length) rule.Actions = actions;
  return {
    RuleName: form.ruleName,
    Status: form.enabled ? 'enable' : 'disable',
    Rules: [rule],
  };
}

function payload() {
  return isEsa.value ? buildEsaPayload() : buildEoPayload();
}

function save() {
  const p = payload();
  if (!String(p.RuleName || '').trim()) return emit('save', p); // 名称校验交由调用方提示
  emit('save', p);
}

function syncFromJson() {
  try {
    const obj = JSON.parse(jsonText.value || '{}');
    loadFrom(obj);
  } catch {
    /* 解析失败时保留用户输入，不覆盖 */
  }
}

function loadFrom(raw: any) {
  const src = raw && typeof raw === 'object' ? raw : {};
  form.ruleName = src.RuleName || src.ruleName || '';
  form.enabled = toEnabled(src.RuleEnable ?? src.Status ?? src.enabled);
  const isDefaultOn = src.RuleEnable === undefined && src.Status === undefined && src.enabled === undefined;
  if (isDefaultOn) form.enabled = true;

  if (isEsa.value) {
    const expr = src.Rule ?? '';
    if (String(expr).trim() === '' || String(expr).trim() === 'true') {
      esaCondMode.value = 'all';
      form.ruleExpr = '';
    } else {
      esaCondMode.value = 'custom';
      form.ruleExpr = String(expr);
    }
    form.sequence = src.Sequence ?? null;
    const data: Record<string, any> = {};
    for (const f of esaActionFields.value) if (src[f.name] !== undefined) data[f.name] = src[f.name];
    form.data = data;
  } else {
    const r = Array.isArray(src.Rules) ? src.Rules[0] : null;
    const groups = Array.isArray(r?.Conditions) ? r.Conditions : [];
    form.eoConditions = groups.length
      ? groups.map((g: any) => ({
          items: (g.Conditions || []).map((c: any) => ({
            target: c.Target,
            operator: c.Operator,
            values: Array.isArray(c.Values) ? c.Values : [],
          })),
        }))
      : [{ items: [{ target: 'url', operator: 'equal', values: [] }] }];
    const acts = Array.isArray(r?.Actions) ? r.Actions : [];
    form.eoActions = acts.length
      ? acts.map((a: any) => {
          const body = a.NormalAction || a.RewriteAction || a.CodeAction || {};
          const params: Record<string, any> = {};
          for (const it of body.Parameters || []) {
            const extraId = propertiesOf(body.Action).find((p: any) => p.ExtraParameter?.Id)?.ExtraParameter?.Id;
            if (extraId === 'Action') params[it.Name] = it.Action;
            else if (extraId === 'StatusCode') params[it.Name] = it.StatusCode;
            else params[it.Name] = (it.Values || []).length === 1 ? it.Values[0] : it.Values || [];
          }
          return { action: body.Action || '', params };
        })
      : [{ action: '', params: {} }];
  }
  jsonText.value = JSON.stringify(payload(), null, 2);
}

async function refreshJson() {
  jsonText.value = JSON.stringify(payload(), null, 2);
}

watch(mode, async (m) => {
  if (m === 'json') await refreshJson();
  else syncFromJson();
});
watch(
  () => props.initial,
  (v) => loadFrom(v || {}),
  { immediate: true, deep: false },
);
watch(
  () => esaActionFields.value.length,
  () => {
    if (props.initial) loadFrom(props.initial);
  },
);
</script>

<style scoped>
.rule-editor__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

/* 条件组 / 动作组：左侧信号条 + 编号徽章，呼应全站信号语义 */
.rule-editor__group {
  border: 1px solid var(--app-divider);
  border-left: 3px solid color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  border-radius: var(--app-radius);
  background: var(--app-surface);
  padding: 10px 12px;
  margin-bottom: 10px;
  transition: border-color 0.2s var(--app-ease);
}
.rule-editor__group:hover {
  border-left-color: var(--app-primary);
}
.rule-editor__group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.rule-editor__group-badge {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--app-primary-weak);
  color: var(--app-primary);
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
}
.rule-editor__group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--app-text-2);
}

/* 条件行：浅色底条 + 控件网格，密集但有序 */
.rule-editor__cond-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-editor__cond-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--app-bg-soft);
}
.rule-editor__cond-target {
  width: 160px;
}
.rule-editor__cond-op {
  width: 130px;
}
.rule-editor__cond-values {
  flex: 1;
  min-width: 200px;
}

.rule-editor__params {
  margin-top: 8px;
  border-top: 1px dashed var(--app-divider);
  padding-top: 10px;
}
</style>
