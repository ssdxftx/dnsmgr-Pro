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
              <n-input-number v-model:value="form.sequence" :min="0" class="rule-editor__seq" clearable />
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

      <!-- EO：官方 IF / ELSE IF / ELSE 分支结构 -->
      <template v-else>
        <div class="zone-panel">
          <div class="zone-panel__head">
            <h3 class="zone-panel__title">{{ t('cdnRules.condTitle') }}</h3>
          </div>

          <div v-for="(br, bi) in form.eoBranches" :key="bi" class="rule-editor__branch">
            <div class="rule-editor__branch-head">
              <span class="rule-editor__branch-badge" :class="{ 'rule-editor__branch-badge--else': br.type === 'else' }">
                {{ branchLabel(br, bi) }}
              </span>
              <span v-if="br.type === 'else'" class="hint-text">{{ t('cdnRules.branchElseHint') }}</span>
              <n-button
                v-if="bi > 0"
                size="tiny"
                type="error"
                quaternary
                style="margin-left: auto"
                @click="form.eoBranches.splice(bi, 1)"
              >
                {{ t('cdnRules.branchRemove') }}
              </n-button>
            </div>

            <!-- 匹配条件：Or 条件组 × 组内 And -->
            <template v-if="br.type !== 'else'">
              <div v-for="(grp, gi) in br.orGroups" :key="gi">
                <div v-if="gi > 0" class="rule-editor__or-divider">Or</div>
                <div class="rule-editor__group">
                  <div class="rule-editor__group-head">
                    <span v-if="br.orGroups.length > 1" class="rule-editor__group-title">
                      {{ t('cdnRules.condGroupTitle', { index: gi + 1 }) }}
                      <span class="hint-text">{{ t('cdnRules.condGroupHint') }}</span>
                    </span>
                    <n-space :size="6" style="margin-left: auto">
                      <n-button size="tiny" @click="addEoCondition(bi, gi)">{{ t('cdnRules.condAddItem') }}</n-button>
                      <n-button v-if="br.orGroups.length > 1" size="tiny" type="error" quaternary @click="br.orGroups.splice(gi, 1)">
                        {{ t('cdnRules.condRemoveGroup') }}
                      </n-button>
                    </n-space>
                  </div>
                  <div class="rule-editor__cond-list">
                    <div v-for="(it, ii) in grp.items" :key="ii" class="rule-editor__cond-row">
                      <n-select
                        v-model:value="it.target"
                        :options="targetSelectOptions"
                        :placeholder="t('cdnRules.condTarget')"
                        size="small"
                        class="rule-editor__cond-target"
                        @update:value="onTargetChange(it)"
                      />
                      <n-select
                        v-if="!isAllTarget(it.target)"
                        v-model:value="it.operator"
                        :options="operatorOptionsOf(it.target)"
                        size="small"
                        class="rule-editor__cond-op"
                      />
                      <n-input
                        v-if="needName(it.target)"
                        v-model:value="it.name"
                        :placeholder="t('cdnRules.condParamName')"
                        size="small"
                        class="rule-editor__cond-name"
                      />
                      <n-dynamic-tags
                        v-if="needValues(it)"
                        v-model:value="it.values"
                        size="small"
                        class="rule-editor__cond-values"
                      />
                      <n-tag v-else-if="!isAllTarget(it.target)" size="small" :bordered="false">
                        {{ t('cdnRules.condNoValue') }}
                      </n-tag>
                      <n-popover v-if="ignoreCaseAble(it.target)" trigger="hover">
                        <template #trigger>
                          <span class="rule-editor__cond-case" @click="it.ignoreCase = !it.ignoreCase">
                            Aa
                          </span>
                        </template>
                        {{ t('cdnRules.condIgnoreCase') }}：{{ it.ignoreCase ? t('common.enabled') : t('common.disabled') }}
                      </n-popover>
                      <n-button size="tiny" type="error" quaternary circle @click="removeEoCondition(bi, gi, ii)">
                        <template #icon><n-icon :component="CloseOutline" /></template>
                      </n-button>
                    </div>
                  </div>
                </div>
              </div>
              <n-button size="small" dashed block style="margin-top: 6px" @click="addEoOrGroup(bi)">
                {{ t('cdnRules.condAddGroup') }}
              </n-button>
            </template>

            <!-- 分支操作列表 -->
            <div class="rule-editor__branch-actions">
              <div v-for="(a, ai) in br.actions" :key="ai" class="rule-editor__group">
                <div class="rule-editor__group-head">
                  <n-select
                    v-model:value="a.action"
                    :options="actionSelectOptions"
                    :placeholder="t('cdnRules.actionPick')"
                    size="small"
                    filterable
                    class="rule-editor__action-pick"
                    @update:value="() => onActionChange(a)"
                  />
                  <n-button size="tiny" type="error" quaternary style="margin-left: auto" @click="br.actions.splice(ai, 1)">
                    {{ t('cdnRules.actionRemove') }}
                  </n-button>
                </div>
                <div v-if="hasParams(a)" class="rule-editor__params">
                  <n-form label-placement="left" label-width="132">
                    <n-form-item
                      v-for="p in propertiesOf(a.action)"
                      :key="p.Name"
                      :label="eoParamLabel(p.Name, localeKey)"
                      :label-props="p.Description ? { title: p.Description } : undefined"
                    >
                      <n-select
                        v-if="p.Type === 'CHOICE'"
                        :value="choiceValueOf(a, p)"
                        :options="choiceOptionsOf(p)"
                        size="small"
                        clearable
                        @update:value="(v: any) => setParamValue(a, p, v)"
                      />
                      <n-switch
                        v-else-if="p.Type === 'TOGGLE'"
                        :value="toEnabled(paramRawValue(a, p))"
                        size="small"
                        @update:value="(v: boolean) => setParamValue(a, p, pickToggle(p, v))"
                      />
                      <n-input-number
                        v-else-if="p.Type === 'CUSTOM_NUM'"
                        :value="numOrNull(paramRawValue(a, p))"
                        :min="p.Min || undefined"
                        :max="p.Max || undefined"
                        size="small"
                        clearable
                        style="width: 100%"
                        @update:value="(v: any) => setParamValue(a, p, v)"
                      />
                      <n-dynamic-tags
                        v-else-if="p.IsMultiple"
                        :value="Array.isArray(paramRawValue(a, p)) ? paramRawValue(a, p) : []"
                        size="small"
                        @update:value="(v: any) => setParamValue(a, p, v)"
                      />
                      <n-input
                        v-else
                        :value="paramStrValue(a, p)"
                        size="small"
                        @update:value="(v: string) => setParamValue(a, p, v)"
                      />
                    </n-form-item>
                    <n-form-item
                      v-for="name in extraParamsOf(a)"
                      :key="'x-' + name"
                      :label="eoParamLabel(name, localeKey)"
                    >
                      <n-dynamic-tags
                        v-if="Array.isArray(a.params[name])"
                        :value="a.params[name]"
                        size="small"
                        @update:value="(v: any) => setParamByName(a, name, v)"
                      />
                      <n-input
                        v-else
                        :value="paramStrValueByName(a, name)"
                        size="small"
                        @update:value="(v: string) => setParamByName(a, name, v)"
                      />
                    </n-form-item>
                  </n-form>
                </div>
              </div>
              <n-button size="small" dashed block style="margin-top: 6px" @click="addEoAction(bi)">
                {{ t('cdnRules.actionAdd') }}
              </n-button>
            </div>
          </div>

          <!-- 分支添加（官方：添加 ELSE IF / 添加 ELSE） -->
          <n-space :size="8" style="margin-top: 10px">
            <n-button size="small" dashed @click="addEoBranch('elseif')">{{ t('cdnRules.branchAddElseIf') }}</n-button>
            <n-button size="small" dashed @click="addEoBranch('else')">{{ t('cdnRules.branchAddElse') }}</n-button>
          </n-space>
          <div class="hint-text" style="margin-top: 8px">{{ t('cdnRules.branchHint') }}</div>
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
  NPopover, NRadioButton, NRadioGroup, NSelect, NSpace, NSwitch, NTag,
} from 'naive-ui';
import { CloseOutline } from '@vicons/ionicons5';
import RuleFieldControl from './RuleFieldControl.vue';
import { toEnabled } from '../../lib/cdnSwitch';
import {
  EO_ACTION_GROUPS, EO_OPERATORS, EO_TARGETS,
  eoActionInfo, eoParamLabel, eoValueLabel, type EoLocale,
} from '../../lib/eoRuleMeta';

const props = defineProps<{
  vendor: 'esa' | 'eo';
  /** ESA：规则字段表；EO：{ actions } */
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
const localeKey = computed<EoLocale>(() => (isZh.value ? 'zh' : 'en'));

const mode = ref<'visual' | 'json'>('visual');
const jsonText = ref('');

interface EoCondItem { target: string; operator: string; name?: string; values: string[]; ignoreCase?: boolean }
interface EoOrGroup { items: EoCondItem[] }
interface EoActionItem { action: string; params: Record<string, any>; kind?: string }
interface EoBranch { type: 'if' | 'elseif' | 'else'; orGroups: EoOrGroup[]; actions: EoActionItem[] }

function newCondItem(): EoCondItem {
  return { target: 'host', operator: 'equal', values: [], ignoreCase: false };
}

const form = reactive<any>({
  ruleName: '',
  enabled: true,
  ruleExpr: '',
  sequence: null,
  data: {} as Record<string, any>,
  eoBranches: [
    { type: 'if', orGroups: [{ items: [newCondItem()] }], actions: [{ action: '', params: {} }] },
  ] as EoBranch[],
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

// ---------- EO 官方元数据 ----------
const eoActions = computed<any[]>(() => (Array.isArray(props.schema?.actions) ? props.schema.actions : []));

/** 匹配类型下拉（官方中文） */
const targetSelectOptions = computed(() =>
  EO_TARGETS.map((x) => ({ label: isZh.value ? x.label.zh : x.label.en, value: x.value })),
);

/** 运算符下拉：官方仅查询字符串 / HTTP 请求头支持「存在/不存在」 */
function operatorOptionsOf(target: string) {
  const meta = EO_TARGETS.find((x) => x.value === target);
  const ops = meta?.existable ? EO_OPERATORS : EO_OPERATORS.filter((o) => o.value === 'equal' || o.value === 'notEquals');
  return ops.map((o) => ({ label: isZh.value ? o.label.zh : o.label.en, value: o.value }));
}

/** 操作下拉：按官方分组（缓存配置 / 网络优化 / HTTPS 优化 / 修改 HTTP 头 / 高级配置），中文显示 */
const actionSelectOptions = computed(() => {
  const byGroup = new Map<string, { label: string; value: string }[]>();
  for (const a of eoActions.value) {
    const name = String(a?.Action || '');
    if (!name) continue;
    const info = eoActionInfo(name, localeKey.value);
    if (!byGroup.has(info.group)) byGroup.set(info.group, []);
    byGroup.get(info.group)!.push({ label: info.label, value: name });
  }
  return EO_ACTION_GROUPS
    .filter((g) => byGroup.has(g.key))
    .map((g) => ({
      type: 'group' as const,
      label: isZh.value ? g.label.zh : g.label.en,
      key: g.key,
      children: byGroup.get(g.key)!,
    }));
});

function isAllTarget(target: string) {
  return target === 'all';
}
function needName(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.needName && !isAllTarget(target);
}
function ignoreCaseAble(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.ignoreCase && !isAllTarget(target);
}
function needValues(it: EoCondItem) {
  if (isAllTarget(it.target)) return false;
  return it.operator !== 'exist' && it.operator !== 'notexist';
}
function onTargetChange(it: EoCondItem) {
  // 切换匹配类型后收敛非法运算符 / 参数名 / 值
  const meta = EO_TARGETS.find((x) => x.value === it.target);
  if (!meta?.existable && (it.operator === 'exist' || it.operator === 'notexist')) it.operator = 'equal';
  if (!meta?.needName) it.name = undefined;
  if (isAllTarget(it.target)) {
    it.operator = 'equal';
    it.values = ['all'];
  } else if (it.values[0] === 'all') {
    it.values = [];
  }
}

// ---------- EO 分支/条件/操作 ----------
function branchLabel(br: EoBranch, idx: number): string {
  if (br.type === 'if') return `IF ${idx + 1}`;
  if (br.type === 'elseif') return `ELSE IF ${idx}`;
  return 'ELSE';
}
function addEoBranch(type: 'elseif' | 'else') {
  // ELSE 只允许存在一个，且位于最后
  if (type === 'else') {
    const branches = form.eoBranches as EoBranch[];
    const last = branches[branches.length - 1];
    if (last?.type === 'else') return;
    branches.push({ type: 'else', orGroups: [], actions: [{ action: '', params: {} }] });
  } else {
    (form.eoBranches as EoBranch[]).push({
      type: 'elseif',
      orGroups: [{ items: [newCondItem()] }],
      actions: [{ action: '', params: {} }],
    });
  }
}
function addEoOrGroup(bi: number) {
  (form.eoBranches as EoBranch[])[bi].orGroups.push({ items: [newCondItem()] });
}
function addEoCondition(bi: number, gi: number) {
  (form.eoBranches as EoBranch[])[bi].orGroups[gi].items.push(newCondItem());
}
function removeEoCondition(bi: number, gi: number, ii: number) {
  const br = (form.eoBranches as EoBranch[])[bi];
  br.orGroups[gi].items.splice(ii, 1);
  if (!br.orGroups[gi].items.length) br.orGroups.splice(gi, 1);
}
function addEoAction(bi: number) {
  (form.eoBranches as EoBranch[])[bi].actions.push({ action: '', params: {} });
}

function propertiesOf(action: string): any[] {
  const hit = eoActions.value.find((a: any) => a.Action === action);
  return Array.isArray(hit?.Properties) ? hit.Properties : [];
}
/** schema 未定义的参数名：多为官方元数据不全时规则里携带的额外参数，必须原样保留 */
function extraParamsOf(a: EoActionItem): string[] {
  const known = new Set(propertiesOf(a.action).map((p: any) => p.Name));
  return Object.keys(a.params).filter((k) => !known.has(k));
}
function hasParams(a: EoActionItem): boolean {
  return propertiesOf(a.action).length > 0 || extraParamsOf(a).length > 0;
}
function paramStrValueByName(a: EoActionItem, name: string): string {
  const v = a.params[name];
  return v === undefined || v === null ? '' : String(v);
}
function setParamByName(a: EoActionItem, name: string, v: any) {
  a.params[name] = v;
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
function onActionChange(a: EoActionItem) {
  a.params = {};
  a.kind = undefined;
}
function paramRawValue(a: EoActionItem, p: any) {
  return a.params[p.Name];
}
function choiceValueOf(a: EoActionItem, p: any) {
  const v = a.params[p.Name];
  return v === undefined || v === null || v === '' ? null : String(v);
}
function paramStrValue(a: EoActionItem, p: any) {
  const v = a.params[p.Name];
  return v === undefined || v === null ? '' : String(v);
}
/** CHOICE 取值选项：官方中文（未收录回退原值） */
function choiceOptionsOf(p: any) {
  return (p.ChoicesValue || []).map((c: any) => ({ label: eoValueLabel(String(c), localeKey.value), value: String(c) }));
}
function setParamValue(a: EoActionItem, p: any, v: any) {
  a.params[p.Name] = v;
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

/** EO：条件行 → 官方 RuleCondition */
function toEoCondition(it: EoCondItem): Record<string, any> {
  const cond: Record<string, any> = {
    Operator: it.operator || 'equal',
    Target: it.target,
    Values: isAllTarget(it.target) ? ['all'] : Array.isArray(it.values) ? it.values.filter((v) => v !== '') : [],
  };
  if (ignoreCaseAble(it.target) && it.ignoreCase) cond.IgnoreCase = true;
  if (needName(it.target) && String(it.name || '').trim()) cond.Name = String(it.name).trim();
  return cond;
}

/** 参数值 → 官方 Values 数组（数组原样透传，标量包成单元素数组，空值给空数组） */
function toParamValues(raw: any): any[] {
  if (raw === undefined || raw === null || raw === '') return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** EO：操作 → 官方 Action（依据 ExtraParameter.Id 判定 NormalAction/RewriteAction/CodeAction） */
function toEoAction(a: EoActionItem): Record<string, any> {
  const props_ = propertiesOf(a.action);
  const known = new Set(props_.map((p: any) => p.Name));
  const params = props_.map((p: any) => {
    const raw = a.params[p.Name];
    const extraId = p.ExtraParameter?.Id;
    const item: Record<string, any> = {};
    if (extraId === 'Action') item.Action = String(raw ?? '');
    if (extraId === 'StatusCode') item.StatusCode = Number(raw ?? 0);
    item.Name = p.Name;
    item.Values = toParamValues(raw);
    return item;
  });
  // 保留 schema 未覆盖的参数：官方 DescribeRulesSetting 元数据不全时，规则里携带的额外参数
  // （如 HTTPUpstreamTimeout.ResponseTimeout、WebSocket.Timeout 等）不得在保存时被丢弃
  for (const [name, raw] of Object.entries(a.params)) {
    if (known.has(name)) continue;
    params.push({ Name: name, Values: toParamValues(raw) });
  }
  const extraId = props_.find((p: any) => p.ExtraParameter?.Id)?.ExtraParameter?.Id;
  const kind = a.kind || (extraId === 'Action' ? 'RewriteAction' : extraId === 'StatusCode' ? 'CodeAction' : 'NormalAction');
  return { [kind]: { Action: a.action, Parameters: params } };
}

/** EO：分支 → { Conditions: RuleAndConditions[], Actions }（官方：组间 Or、组内 And；ELSE 无条件） */
function toEoBranchRule(br: EoBranch): { Conditions: any[]; Actions: any[] } {
  const groups = br.type === 'else'
    ? []
    : br.orGroups
        .map((g) => ({
          Conditions: g.items
            .filter((it) => it && it.target && it.operator)
            .map(toEoCondition),
        }))
        .filter((g) => g.Conditions.length);
  return {
    Conditions: groups,
    Actions: br.actions.filter((a) => a.action).map(toEoAction),
  };
}

/** EO payload：{ RuleName, Status, Rules:[{Conditions,Actions,SubRules}] }（官方 IF/ELSE IF/ELSE 结构） */
function buildEoPayload(): Record<string, any> {
  const branches = form.eoBranches as EoBranch[];
  const main = toEoBranchRule(branches[0] || { type: 'if', orGroups: [], actions: [] });
  const subRules = branches.slice(1).map((b) => ({ Rules: [toEoBranchRule(b)] }));
  const rule: Record<string, any> = { Conditions: main.Conditions, Actions: main.Actions };
  if (subRules.length) rule.SubRules = subRules;
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

/** 官方 Conditions → 可视化 Or 条件组 */
function parseEoGroups(conditions: any[]): EoOrGroup[] {
  const groups = Array.isArray(conditions) ? conditions : [];
  return groups
    .map((g) => ({
      items: (g?.Conditions || []).map((c: any) => ({
        target: String(c.Target || ''),
        operator: String(c.Operator || 'equal'),
        name: c.Name ? String(c.Name) : undefined,
        values: Array.isArray(c.Values) ? c.Values.map(String) : [],
        ignoreCase: c.IgnoreCase === true,
      })),
    }))
    .filter((g) => g.items.length);
}

/** 官方 Actions → 可视化操作项 */
function parseEoActions(actions: any[]): EoActionItem[] {
  const list = Array.isArray(actions) ? actions : [];
  const parsed = list
    .map((a: any) => {
      const kind = a.NormalAction ? 'NormalAction' : a.RewriteAction ? 'RewriteAction' : a.CodeAction ? 'CodeAction' : 'NormalAction';
      const body = a.NormalAction || a.RewriteAction || a.CodeAction || {};
      const params: Record<string, any> = {};
      for (const it of body.Parameters || []) {
        const extraId = propertiesOf(body.Action).find((p: any) => p.ExtraParameter?.Id)?.ExtraParameter?.Id;
        if (extraId === 'Action') params[it.Name] = it.Action;
        else if (extraId === 'StatusCode') params[it.Name] = it.StatusCode;
        else params[it.Name] = (it.Values || []).length === 1 ? it.Values[0] : it.Values || [];
      }
      return { action: body.Action || '', params, kind };
    })
    .filter((a) => a.action);
  return parsed.length ? parsed : [{ action: '', params: {} }];
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
    // IF 1 = Rules[0]；ELSE IF / ELSE = SubRules[n].Rules[0]（无 Conditions 即 ELSE）
    const r = Array.isArray(src.Rules) ? src.Rules[0] : null;
    const branches: EoBranch[] = [
      {
        type: 'if',
        orGroups: parseEoGroups(r?.Conditions),
        actions: parseEoActions(r?.Actions),
      },
    ];
    if (Array.isArray(r?.SubRules)) {
      for (const sub of r.SubRules) {
        const sr = (sub?.Rules || [])[0] || {};
        const hasCond = (sr.Conditions || []).some((g: any) => (g?.Conditions || []).length);
        branches.push({
          type: hasCond ? 'elseif' : 'else',
          orGroups: parseEoGroups(sr.Conditions),
          actions: parseEoActions(sr.Actions),
        });
      }
    }
    form.eoBranches = branches.length ? branches : [{ type: 'if', orGroups: [], actions: [] }];
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
.rule-editor__seq {
  width: 160px;
}

/* 分支：IF / ELSE IF / ELSE（官方编辑页结构） */
.rule-editor__branch {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  padding: 12px 14px;
  margin-bottom: 12px;
}
.rule-editor__branch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.rule-editor__branch-badge {
  font-family: var(--app-font-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border-radius: 6px;
  padding: 2px 10px;
  letter-spacing: 0.04em;
}
.rule-editor__branch-badge--else {
  color: var(--app-text-2);
  background: var(--app-bg-soft);
}
.rule-editor__or-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-text-3);
  letter-spacing: 0.08em;
}
.rule-editor__or-divider::before,
.rule-editor__or-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--app-divider);
}
.rule-editor__branch-actions {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--app-divider);
}

/* 条件组 / 操作组：左侧信号条 + 编号徽章，呼应全站信号语义 */
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
.rule-editor__cond-name {
  width: 140px;
}
.rule-editor__cond-values {
  flex: 1;
  min-width: 200px;
}
.rule-editor__cond-case {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--app-divider);
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-text-3);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.rule-editor__cond-case:hover {
  border-color: var(--app-primary);
  color: var(--app-primary);
}

.rule-editor__action-pick {
  flex: 1;
  min-width: 300px;
  max-width: 480px;
}

.rule-editor__params {
  margin-top: 8px;
  border-top: 1px dashed var(--app-divider);
  padding-top: 10px;
}

/* 移动端：全部固定宽度改为弹性，避免横向溢出 */
@media (max-width: 767px) {
  .rule-editor__cond-target {
    width: auto;
    flex: 1 1 150px;
    min-width: 0;
  }
  .rule-editor__cond-op {
    width: auto;
    flex: 1 1 120px;
    min-width: 0;
  }
  .rule-editor__cond-name {
    width: auto;
    flex: 1 1 120px;
    min-width: 0;
  }
  .rule-editor__cond-values {
    min-width: 130px;
  }
  .rule-editor__action-pick {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    flex-basis: 100%;
  }
  .rule-editor__seq {
    width: 100%;
  }
  .rule-editor__group {
    padding: 8px 10px;
  }
}
</style>
