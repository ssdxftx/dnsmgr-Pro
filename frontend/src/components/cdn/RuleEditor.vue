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
              <n-radio-group v-if="br.type !== 'else'" v-model:value="br.condMode" size="small">
                <n-radio-button value="visual">{{ t('cdnRules.condVisual') }}</n-radio-button>
                <n-radio-button value="expr">{{ t('cdnRules.condExprMode') }}</n-radio-button>
              </n-radio-group>
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

            <!-- 注释（官方：IF 注释） -->
            <n-form label-placement="left" label-width="132" style="margin-bottom: 10px">
              <n-form-item :label="t('cdnRules.branchComment')">
                <n-input v-model:value="br.comment" size="small" clearable :placeholder="t('cdnRules.branchCommentPlaceholder')" />
              </n-form-item>
            </n-form>

            <!-- 匹配条件 -->
            <template v-if="br.type !== 'else'">
              <n-input
                v-if="br.condMode === 'expr'"
                v-model:value="br.condExpr"
                type="textarea"
                :rows="2"
                :placeholder="t('cdnRules.condExprHintEo')"
                class="mono-input"
                spellcheck="false"
              />
              <template v-else>
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
                        <n-tag v-else size="small" :bordered="false">{{ t('cdnRules.condNoValue') }}</n-tag>
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
            </template>

            <!-- 分支操作列表 -->
            <div class="rule-editor__branch-actions">
              <div v-for="(a, ai) in br.actions" :key="ai" class="rule-editor__group">
                <div class="rule-editor__group-head">
                  <n-select
                    v-model:value="a.name"
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
                <div v-if="eoActionFields(a.name).length" class="rule-editor__params">
                  <EoParamFields :fields="eoActionFields(a.name)" :model="a.params" :locale="localeKey" />
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
      <n-input v-model:value="jsonText" type="textarea" :rows="18" spellcheck="false" class="mono-input" />
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
import EoParamFields from './EoParamFields.vue';
import { toEnabled } from '../../lib/cdnSwitch';
import {
  EO_ACTION_GROUPS, EO_OPERATORS, EO_TARGETS,
  eoActionInfo, type EoLocale,
} from '../../lib/eoRuleMeta';
import { EO_ACTION_SCHEMAS, eoActionFields, eoParamKey, type EoField } from '../../lib/eoRuleSchema';
import { buildCondition, parseCondition, type EoCondItem, type EoOrGroup } from '../../lib/eoRuleExpr';

const props = defineProps<{
  vendor: 'esa' | 'eo';
  /** ESA：规则字段表；EO：保留占位 */
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

interface EoActionItem { name: string; params: Record<string, any> }
interface EoBranch { type: 'if' | 'elseif' | 'else'; comment: string; condMode: 'visual' | 'expr'; condExpr: string; orGroups: EoOrGroup[]; actions: EoActionItem[] }

function newCondItem(): EoCondItem {
  return { target: 'host', operator: 'equal', values: [], ignoreCase: false };
}
function newAction(): EoActionItem {
  return { name: '', params: {} };
}
function newBranch(type: EoBranch['type']): EoBranch {
  return {
    type,
    comment: '',
    condMode: 'visual',
    condExpr: '',
    orGroups: type === 'else' ? [] : [{ items: [newCondItem()] }],
    actions: [newAction()],
  };
}

const form = reactive<any>({
  ruleName: '',
  enabled: true,
  ruleExpr: '',
  sequence: null,
  data: {} as Record<string, any>,
  eoBranches: [newBranch('if')] as EoBranch[],
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
/** 匹配类型下拉（官方中文，去掉「全部」——全部请求即 ELSE 分支） */
const targetSelectOptions = computed(() =>
  EO_TARGETS.filter((x) => x.value !== 'all').map((x) => ({ label: isZh.value ? x.label.zh : x.label.en, value: x.value })),
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
  for (const s of EO_ACTION_SCHEMAS) {
    const info = eoActionInfo(s.name, localeKey.value);
    if (!byGroup.has(info.group)) byGroup.set(info.group, []);
    byGroup.get(info.group)!.push({ label: info.label, value: s.name });
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

function needName(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.needName;
}
function ignoreCaseAble(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.ignoreCase;
}
function needValues(it: EoCondItem) {
  return it.operator !== 'exist' && it.operator !== 'notexist';
}
function onTargetChange(it: EoCondItem) {
  // 切换匹配类型后收敛非法运算符 / 参数名 / 值
  const meta = EO_TARGETS.find((x) => x.value === it.target);
  if (!meta?.existable && (it.operator === 'exist' || it.operator === 'notexist')) it.operator = 'equal';
  if (!meta?.needName) it.name = undefined;
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
    branches.push(newBranch('else'));
  } else {
    (form.eoBranches as EoBranch[]).push(newBranch('elseif'));
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
  (form.eoBranches as EoBranch[])[bi].actions.push(newAction());
}
function onActionChange(a: EoActionItem) {
  a.params = {};
  const fields = eoActionFields(a.name);
  // 新增操作时，顶层开关默认开启（与官方新增操作一致）
  for (const f of fields) if (f.type === 'switch' && a.params[f.name] === undefined) a.params[f.name] = 'on';
  ensureStructure(fields, a.params);
}

/** 保证操作参数结构完整（分组对象 / 列表数组 / oneof 生效分支存在），避免渲染期补建 */
function ensureStructure(fields: EoField[], params: Record<string, any>) {
  for (const f of fields) {
    if (f.type === 'group') {
      if (!params[f.name] || typeof params[f.name] !== 'object' || Array.isArray(params[f.name])) params[f.name] = {};
      ensureStructure(f.fields || [], params[f.name]);
    } else if (f.type === 'list') {
      if (!Array.isArray(params[f.name])) params[f.name] = [];
      for (const item of params[f.name]) ensureStructure(f.itemFields || [], item);
    } else if (f.type === 'oneof') {
      const variants = f.variants || [];
      const key =
        variants.find((v) => params[v.key] && params[v.key].Switch === 'on')?.key ||
        variants.find((v) => params[v.key] && typeof params[v.key] === 'object')?.key ||
        variants[0]?.key;
      if (key) {
        if (!params[key] || typeof params[key] !== 'object') params[key] = {};
        if (params[key].Switch === undefined) params[key].Switch = 'on';
        ensureStructure(variants.find((v) => v.key === key)?.fields || [], params[key]);
      }
    }
  }
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

/** 递归剔除空值（空串 / null / undefined / 空对象），保留 off / 0 / 空数组等有效取值 */
function pruneParams(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    if (typeof v === 'object') {
      const c = pruneParams(v);
      if (Object.keys(c).length) out[k] = c;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** EO：操作 → 官方 RuleEngineAction（Name + <Name>Parameters） */
function toEoAction(a: EoActionItem): Record<string, any> {
  return { Name: a.name, [eoParamKey(a.name)]: pruneParams(a.params) };
}

/** 分支条件 → 表达式字符串（ELSE 无条件） */
function branchCondition(br: EoBranch): string {
  if (br.type === 'else') return '';
  if (br.condMode === 'expr') return String(br.condExpr || '').trim();
  return buildCondition(br.orGroups);
}

function branchActions(br: EoBranch): Record<string, any>[] {
  return br.actions.filter((a) => a.name).map(toEoAction);
}

/** EO payload：官方 RuleEngineItem { RuleName, Status, Branches }（IF 为主分支，其余为 SubRules） */
function buildEoRuleItem(): Record<string, any> {
  const branches = form.eoBranches as EoBranch[];
  const first = branches[0] || newBranch('if');
  const root: Record<string, any> = {};
  const c0 = branchCondition(first);
  if (c0) root.Condition = c0;
  const a0 = branchActions(first);
  if (a0.length) root.Actions = a0;
  const subs = branches.slice(1).map((b) => {
    const br: Record<string, any> = {};
    const c = branchCondition(b);
    if (c) br.Condition = c;
    const acts = branchActions(b);
    if (acts.length) br.Actions = acts;
    return { Branches: [br], Description: b.comment ? [b.comment] : [] };
  });
  if (subs.length) root.SubRules = subs;
  return {
    RuleName: form.ruleName,
    Status: form.enabled ? 'enable' : 'disable',
    Branches: [root],
    Description: first.comment ? [first.comment] : [],
  };
}

function payload() {
  return isEsa.value ? buildEsaPayload() : buildEoRuleItem();
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

/** 官方 RuleEngineAction[] → 可视化操作项 */
function parseEoActions(actions: any[]): EoActionItem[] {
  const list = Array.isArray(actions) ? actions : [];
  const parsed = list
    .map((a: any) => {
      const name = String(a?.Name || '');
      if (!name) return null;
      const key = eoParamKey(name);
      const params = a?.[key] && typeof a[key] === 'object' ? JSON.parse(JSON.stringify(a[key])) : {};
      ensureStructure(eoActionFields(name), params);
      return { name, params };
    })
    .filter(Boolean) as EoActionItem[];
  return parsed.length ? parsed : [newAction()];
}

/** 官方 RuleBranch → 可视化分支 */
function parseEoBranch(b: any, type: EoBranch['type'], comment = ''): EoBranch {
  const cond = b?.Condition ? String(b.Condition) : '';
  const parsed = cond ? parseCondition(cond) : [];
  const condMode: EoBranch['condMode'] = cond && parsed === null ? 'expr' : 'visual';
  return {
    type: cond ? type : 'else',
    comment,
    condMode,
    condExpr: cond,
    orGroups: condMode === 'visual' ? parsed || [] : [],
    actions: parseEoActions(b?.Actions),
  };
}

function descriptionText(desc: any): string {
  return Array.isArray(desc) && desc.length ? String(desc[0] ?? '') : '';
}

function loadFrom(raw: any) {
  const src = raw && typeof raw === 'object' ? raw : {};
  // 兼容 { FormatVersion, Rules:[item] } 包裹
  const item = Array.isArray(src.Rules) && src.Rules.length ? src.Rules[0] : src;
  form.ruleName = item.RuleName || src.RuleName || src.ruleName || '';
  // 官方控制台 JSON 视图不含 Status（启用状态由独立开关控制）；仅当来源带状态时才覆盖
  const hasStatus = item.Status !== undefined || src.Status !== undefined || src.enabled !== undefined;
  if (hasStatus) form.enabled = toEnabled(item.Status ?? src.Status ?? src.enabled);

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
    const list: EoBranch[] = [];
    const top = Array.isArray(item.Branches) ? item.Branches : [];
    top.forEach((b: any, i: number) => {
      list.push(parseEoBranch(b, i === 0 ? 'if' : 'elseif', i === 0 ? descriptionText(item.Description) : ''));
      for (const sub of b?.SubRules || []) {
        for (const sb of sub?.Branches || []) list.push(parseEoBranch(sb, 'elseif', descriptionText(sub?.Description)));
      }
    });
    form.eoBranches = list.length ? list : [newBranch('if')];
  }
  jsonText.value = JSON.stringify(jsonDocument(), null, 2);
}

/** JSON 视图：EO 采用官方控制台格式（FormatVersion + Rules，不含 Status） */
function jsonDocument(): any {
  if (isEsa.value) return buildEsaPayload();
  const rule = buildEoRuleItem();
  delete rule.Status;
  return { FormatVersion: '1.0', Rules: [rule] };
}

async function refreshJson() {
  jsonText.value = JSON.stringify(jsonDocument(), null, 2);
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
