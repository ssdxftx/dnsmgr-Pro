<template>
  <div class="rule-editor">
    <!-- 模式切换 + 操作条（玻璃工具条） -->
    <div class="rule-editor__bar">
      <div class="rule-editor__mode-pill">
        <n-radio-group v-model:value="mode" size="small">
          <n-radio-button value="visual">{{ t('cdnRules.modeVisual') }}</n-radio-button>
          <n-radio-button value="json">{{ t('cdnRules.modeJson') }}</n-radio-button>
        </n-radio-group>
      </div>
      <n-space :size="8">
        <n-button v-if="editing" size="small" @click="emit('cancel')">{{ t('common.cancel') }}</n-button>
        <n-button size="small" type="primary" :loading="saving" @click="save">{{ t('common.save') }}</n-button>
      </n-space>
    </div>

    <!-- ============ 可视化模式 ============ -->
    <template v-if="mode === 'visual'">
      <div class="zone-panel rule-editor__card">
        <div class="zone-panel__head">
          <h3 class="zone-panel__title">{{ t('cdnRules.groupCommon') }}</h3>
        </div>
        <n-form :label-placement="formLabelPlacement" :label-width="formLabelWidth">
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
      <div v-if="isEsa" class="zone-panel rule-editor__card">
        <div class="zone-panel__head">
          <h3 class="zone-panel__title">{{ t('cdnRules.groupAction') }}</h3>
        </div>
        <n-form :label-placement="formLabelPlacement" :label-width="formLabelWidth">
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

      <!-- EO：官方 IF / ELSE IF / ELSE 分支结构（信号阶梯卡片流） -->
      <template v-else>
        <div class="zone-panel rule-editor__card">
          <div class="zone-panel__head">
            <h3 class="zone-panel__title">{{ t('cdnRules.condTitle') }}</h3>
          </div>

          <!-- 信号阶梯：分支沿左侧轨道依次排布，表达自上而下判定 -->
          <div class="rule-editor__ladder">
            <section
              v-for="(br, bi) in form.eoBranches"
              :key="bi"
              class="rule-editor__branch"
              :class="{ 'rule-editor__branch--else': br.type === 'else' }"
              :style="{ '--i': bi }"
            >
              <header class="rule-editor__branch-head">
                <span class="rule-editor__branch-badge" :class="{ 'rule-editor__branch-badge--else': br.type === 'else' }">
                  <i class="rule-editor__branch-dot" aria-hidden="true" />{{ branchLabel(br, bi) }}
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
              </header>

              <!-- 注释（官方：IF 注释） -->
              <n-form :label-placement="formLabelPlacement" :label-width="formLabelWidth" style="margin-bottom: 10px">
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
                <div v-else class="rule-editor__conds">
                  <template v-for="(grp, gi) in br.orGroups" :key="gi">
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
                          <ConditionPicker
                            kind="target"
                            :model-value="it.target"
                            :options="targetCardOptions"
                            class="rule-editor__cond-target"
                            @select="(v: string) => applyTarget(it, v)"
                          />
                          <ConditionPicker
                            kind="operator"
                            :model-value="it.operator"
                            :options="operatorOptionsOf(it.target)"
                            class="rule-editor__cond-op"
                            @select="(v: string) => (it.operator = v)"
                          />
                          <n-input
                            v-if="needName(it.target)"
                            v-model:value="it.name"
                            :placeholder="t('cdnRules.condParamName')"
                            size="small"
                            class="rule-editor__cond-name"
                          />
                          <n-select
                            v-if="needValues(it) && isHostChoice(it)"
                            v-model:value="it.values"
                            :options="hostOptions"
                            multiple
                            filterable
                            tag
                            size="small"
                            class="rule-editor__cond-values"
                            :placeholder="t('cdnRules.condHostPick')"
                          />
                          <n-dynamic-tags
                            v-else-if="needValues(it)"
                            v-model:value="it.values"
                            size="small"
                            class="rule-editor__cond-values"
                          />
                          <n-tag v-else size="small" :bordered="false">{{ t('cdnRules.condNoValue') }}</n-tag>
                          <n-popover v-if="ignoreCaseAble(it.target)" trigger="hover">
                            <template #trigger>
                              <span
                                class="rule-editor__cond-case"
                                :class="{ 'rule-editor__cond-case--on': it.ignoreCase }"
                                @click="it.ignoreCase = !it.ignoreCase"
                              >
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
                  </template>
                  <n-button size="small" dashed block class="rule-editor__add" @click="addEoOrGroup(bi)">
                    {{ t('cdnRules.condAddGroup') }}
                  </n-button>
                </div>
              </template>

              <!-- 分支操作列表 -->
              <div class="rule-editor__branch-actions">
                <div class="rule-editor__actions-caption">
                  <span class="rule-editor__actions-caption-text">{{ t('cdnRules.actionTitle') }}</span>
                </div>
                <div v-for="(a, ai) in br.actions" :key="ai" class="rule-editor__group rule-editor__group--action">
                  <div class="rule-editor__group-head">
                    <ActionPicker
                      :model-value="a.name"
                      :locale="localeKey"
                      class="rule-editor__action-pick"
                      @select="(name: string) => applyActionName(a, name)"
                    />
                    <n-button size="tiny" type="error" quaternary style="margin-left: auto" @click="br.actions.splice(ai, 1)">
                      {{ t('cdnRules.actionRemove') }}
                    </n-button>
                  </div>
                  <div v-if="eoActionFields(a.name).length" class="rule-editor__params">
                    <EoParamFields :fields="eoActionFields(a.name)" :model="a.params" :locale="localeKey" :stacked="isMobile" />
                  </div>
                </div>
                <n-button size="small" dashed block class="rule-editor__add" @click="addEoAction(bi)">
                  {{ t('cdnRules.actionAdd') }}
                </n-button>
              </div>
            </section>
          </div>

          <!-- 分支添加（官方：添加 ELSE IF / 添加 ELSE） -->
          <div class="rule-editor__branch-add">
            <n-button size="small" dashed class="rule-editor__add" @click="addEoBranch('elseif')">{{ t('cdnRules.branchAddElseIf') }}</n-button>
            <n-button size="small" dashed class="rule-editor__add" @click="addEoBranch('else')">{{ t('cdnRules.branchAddElse') }}</n-button>
          </div>
          <div class="hint-text" style="margin-top: 8px">{{ t('cdnRules.branchHint') }}</div>
        </div>
      </template>
    </template>

    <!-- ============ JSON 源码模式 ============ -->
    <template v-else>
      <div class="zone-panel rule-editor__card">
        <n-alert type="info" :show-icon="false" style="margin-bottom: 10px">{{ t('cdnRules.modeJsonHint') }}</n-alert>
        <div class="rule-editor__json-frame">
          <n-input v-model:value="jsonText" type="textarea" :rows="18" spellcheck="false" class="mono-input" />
        </div>
        <n-space justify="end" style="margin-top: 10px">
          <n-button size="small" @click="syncFromJson">{{ t('cdnRules.modeVisual') }}</n-button>
        </n-space>
      </div>
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
import ActionPicker from './ActionPicker.vue';
import ConditionPicker from './ConditionPicker.vue';
import { useResponsive } from '../../composables/useResponsive';
import { toEnabled } from '../../lib/cdnSwitch';
import { EO_OPERATORS, EO_TARGETS, type EoLocale } from '../../lib/eoRuleMeta';
import { eoActionFields, eoParamKey, type EoField } from '../../lib/eoRuleSchema';
import { timeTransform, restoreSeconds, pickTimeUnit } from '../../lib/eoTime';
import { buildCondition, parseCondition, type EoCondItem, type EoOrGroup } from '../../lib/eoRuleExpr';

const props = defineProps<{
  vendor: 'esa' | 'eo';
  /** ESA：规则字段表；EO：保留占位 */
  schema: any;
  /** 编辑既有规则时的初始数据 */
  initial?: any;
  editing?: boolean;
  saving?: boolean;
  /** 当前站点域名，用于 HOST 等于/不等于时直接选择 */
  domains?: string[];
}>();
const emit = defineEmits<{
  (e: 'save', payload: Record<string, any>): void;
  (e: 'cancel'): void;
}>();

const { t, te, locale } = useI18n();
const { isMobile } = useResponsive();
const isEsa = computed(() => props.vendor === 'esa');
const isZh = computed(() => String(locale.value || '').toLowerCase().startsWith('zh'));
const localeKey = computed<EoLocale>(() => (isZh.value ? 'zh' : 'en'));

/** 窄屏标签置顶，宽屏左右布局 */
const formLabelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));
const formLabelWidth = computed(() => (isMobile.value ? undefined : 132));

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
/** 匹配类型卡片：官方中文名 + 作用说明（去掉「全部」——全部请求即 ELSE 分支） */
const targetCardOptions = computed(() =>
  EO_TARGETS.filter((x) => x.value !== 'all').map((x) => ({
    value: x.value,
    label: isZh.value ? x.label.zh : x.label.en,
    desc: isZh.value ? x.desc.zh : x.desc.en,
  })),
);

/** 运算符卡片：官方仅查询字符串 / HTTP 请求头支持「存在/不存在」 */
function operatorOptionsOf(target: string) {
  const meta = EO_TARGETS.find((x) => x.value === target);
  const ops = meta?.existable ? EO_OPERATORS : EO_OPERATORS.filter((o) => o.value === 'equal' || o.value === 'notEquals' || o.value === 'matches');
  return ops.map((o) => ({
    value: o.value,
    label: isZh.value ? o.label.zh : o.label.en,
    desc: isZh.value ? o.desc.zh : o.desc.en,
  }));
}

function needName(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.needName;
}
function ignoreCaseAble(target: string) {
  return !!EO_TARGETS.find((x) => x.value === target)?.ignoreCase;
}
function needValues(it: EoCondItem) {
  return it.operator !== 'exist' && it.operator !== 'notexist';
}
/** HOST 的「等于/不等于」直接提供站点域名供选择 */
function isHostChoice(it: EoCondItem) {
  return it.target === 'host' && (it.operator === 'equal' || it.operator === 'notEquals');
}
const hostOptions = computed(() =>
  (props.domains || []).filter((d) => !!d).map((d) => ({ label: d, value: d })),
);
function onTargetChange(it: EoCondItem) {
  // 切换匹配类型后收敛非法运算符 / 参数名 / 值
  const meta = EO_TARGETS.find((x) => x.value === it.target);
  if (!meta?.existable && (it.operator === 'exist' || it.operator === 'notexist')) it.operator = 'equal';
  if (!meta?.needName) it.name = undefined;
}

/** 匹配类型卡片选择：先写入新类型再执行既有收敛逻辑（与原下拉选择行为一致） */
function applyTarget(it: EoCondItem, target: string) {
  it.target = target;
  onTargetChange(it);
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

/** 动作大卡片选择：写入动作名后沿用既有 onActionChange 初始化参数（与原下拉选择行为一致） */
function applyActionName(a: EoActionItem, name: string) {
  a.name = name;
  onActionChange(a);
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
    } else if (f.type === 'number' && f.time) {
      if (!params.__units || typeof params.__units !== 'object') params.__units = {};
      if (!params.__units[f.name]) params.__units[f.name] = pickTimeUnit(params[f.name]);
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

/** 递归剔除空值（空串 / null / undefined / 空对象）与内部键（__ 前缀，如 __units），保留 off / 0 / 空数组等有效取值 */
function pruneParams(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k.startsWith('__')) continue;
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

/** EO：操作 → 官方 RuleEngineAction（Name + <Name>Parameters）
 *  display=true 时时间字段按所选单位展示（用于 JSON 视图；真实写入仍为秒） */
function toEoAction(a: EoActionItem, display = false): Record<string, any> {
  const fields = eoActionFields(a.name);
  const params = display ? timeTransform(fields, a.params, 'toDisplay') : a.params;
  return { Name: a.name, [eoParamKey(a.name)]: pruneParams(params) };
}

/** 分支条件 → 表达式字符串（ELSE 无条件） */
function branchCondition(br: EoBranch): string {
  if (br.type === 'else') return '';
  if (br.condMode === 'expr') return String(br.condExpr || '').trim();
  return buildCondition(br.orGroups);
}

function branchActions(br: EoBranch, display = false): Record<string, any>[] {
  return br.actions.filter((a) => a.name).map((a) => toEoAction(a, display));
}

/** EO payload：官方 RuleEngineItem { RuleName, Status, Branches }（IF 为主分支，其余为 SubRules） */
function buildEoRuleItem(display = false): Record<string, any> {
  const branches = form.eoBranches as EoBranch[];
  const first = branches[0] || newBranch('if');
  const root: Record<string, any> = {};
  const c0 = branchCondition(first);
  if (c0) root.Condition = c0;
  const a0 = branchActions(first, display);
  if (a0.length) root.Actions = a0;
  const subs = branches.slice(1).map((b) => {
    const br: Record<string, any> = {};
    const c = branchCondition(b);
    if (c) br.Condition = c;
    const acts = branchActions(b, display);
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
    loadFrom(obj, { fromJson: true });
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

function loadFrom(raw: any, opts: { fromJson?: boolean } = {}) {
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
    // JSON 视图中的时间值为展示单位；先快照当前单位选择，解析后按此还原为秒
    const prev = opts.fromJson ? (JSON.parse(JSON.stringify(form.eoBranches)) as EoBranch[]) : [];
    const list: EoBranch[] = [];
    const top = Array.isArray(item.Branches) ? item.Branches : [];
    top.forEach((b: any, i: number) => {
      list.push(parseEoBranch(b, i === 0 ? 'if' : 'elseif', i === 0 ? descriptionText(item.Description) : ''));
      for (const sub of b?.SubRules || []) {
        for (const sb of sub?.Branches || []) list.push(parseEoBranch(sb, 'elseif', descriptionText(sub?.Description)));
      }
    });
    form.eoBranches = list.length ? list : [newBranch('if')];
    if (opts.fromJson) {
      list.forEach((br, bi) => {
        const pb = prev[bi];
        br.actions.forEach((a, ai) => restoreSeconds(eoActionFields(a.name), a.params, pb?.actions?.[ai]?.params));
      });
    }
  }
  jsonText.value = JSON.stringify(jsonDocument(), null, 2);
}

/** JSON 视图：EO 采用官方控制台格式（FormatVersion + Rules，不含 Status）；
 *  时间字段按用户所选单位展示（仅影响展示，保存仍写入秒） */
function jsonDocument(): any {
  if (isEsa.value) return buildEsaPayload();
  const rule = buildEoRuleItem(true);
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
/* ===========================================================================
   规则编辑器 · 信号阶梯（Signal Ladder）
   设计意图：IF / ELSE IF / ELSE 分支沿左侧发光轨道纵向排布，
   把「自上而下依次判定」的官方语义画成一张流程图；
   全部颜色 / 圆角 / 阴影 / 动效取自 tokens.css，与全站 Glass NOC 风格一致。
   =========================================================================== */

/* ---- 顶部工具条：玻璃质感，承载模式切换与保存 ---- */
.rule-editor__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 10px;
  margin-bottom: 14px;
  background: var(--app-surface-2);
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-sm);
}
.rule-editor__mode-pill {
  display: flex;
  align-items: center;
  padding: 2px;
  border-radius: 10px;
  background: var(--app-bg-soft);
  border: 1px solid var(--app-divider);
}
.rule-editor__seq {
  width: 160px;
}

/* ---- 分区卡片：编辑器内统一容器，沿用 zone-panel 观感 ---- */
.rule-editor__card + .rule-editor__card {
  margin-top: 12px;
}

/* ===========================================================================
   分支卡片 · 信号阶梯
   =========================================================================== */
.rule-editor__ladder {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-left: 26px;
}
/* 竖向轨道线：从首分支节点连到末分支节点 */
.rule-editor__ladder::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 24px;
  bottom: 24px;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--app-primary) 45%, var(--app-divider)),
    var(--app-divider)
  );
}

.rule-editor__branch {
  position: relative;
  background: var(--app-surface);
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  padding: 14px 16px 16px;
  box-shadow: var(--app-shadow-sm);
  transition: border-color 0.2s var(--app-ease), box-shadow 0.25s var(--app-ease);
}
.rule-editor__branch:hover {
  border-color: color-mix(in srgb, var(--app-primary) 32%, var(--app-border));
  box-shadow: var(--app-shadow);
}
/* 卡片左侧信号条 */
.rule-editor__branch::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 3px;
  border-radius: 3px;
  background: linear-gradient(180deg, var(--app-primary), color-mix(in srgb, var(--app-primary) 30%, transparent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--app-primary) 35%, transparent);
}
/* 轨道节点圆点：与竖线对齐 */
.rule-editor__branch::after {
  content: '';
  position: absolute;
  left: -23px;
  top: 20px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--app-surface);
  border: 2px solid var(--app-primary);
  box-shadow: 0 0 0 3px var(--app-primary-weak), 0 0 10px color-mix(in srgb, var(--app-primary) 45%, transparent);
}
/* ELSE 分支：信号弱化（兜底语义） */
.rule-editor__branch--else::before {
  background: var(--app-border);
  box-shadow: none;
}
.rule-editor__branch--else::after {
  border-color: var(--app-text-3);
  box-shadow: 0 0 0 3px var(--app-bg-soft);
}

.rule-editor__branch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
/* 分支徽章：等宽大写 + 脉冲指示灯 */
.rule-editor__branch-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-primary);
  background: var(--app-primary-weak);
  border: 1px solid color-mix(in srgb, var(--app-primary) 22%, transparent);
  border-radius: 999px;
  padding: 3px 12px 3px 9px;
  letter-spacing: 0.1em;
}
.rule-editor__branch-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--app-primary);
  box-shadow: 0 0 6px color-mix(in srgb, var(--app-primary) 60%, transparent);
}
.rule-editor__branch-badge--else {
  color: var(--app-text-2);
  background: var(--app-bg-soft);
  border-color: var(--app-divider);
}
.rule-editor__branch-badge--else .rule-editor__branch-dot {
  background: var(--app-text-3);
  box-shadow: none;
}
@keyframes re-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ===========================================================================
   条件区：条件组子卡片 + 条件行 + Or 分隔
   =========================================================================== */
.rule-editor__conds {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Or 分隔线：虚线 + 等宽大写，呼应表达式语义 */
.rule-editor__or-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0;
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--app-text-3);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.rule-editor__or-divider::before,
.rule-editor__or-divider::after {
  content: '';
  flex: 1;
  height: 0;
  border-top: 1px dashed var(--app-border);
}

/* 条件组 / 动作组：左侧信号条子卡片（沿用全站信号语义） */
.rule-editor__group {
  border: 1px solid var(--app-divider);
  border-left: 3px solid color-mix(in srgb, var(--app-primary) 55%, var(--app-border));
  border-radius: var(--app-radius);
  background: var(--app-surface-2);
  padding: 10px 12px;
  transition: border-color 0.2s var(--app-ease), background 0.2s var(--app-ease);
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

/* 条件行：白底芯片行，hover / focus-within 给出信号反馈 */
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
  padding: 7px 9px;
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-sm);
  background: var(--app-surface);
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.rule-editor__cond-row:hover {
  border-color: color-mix(in srgb, var(--app-primary) 30%, var(--app-divider));
}
.rule-editor__cond-row:focus-within {
  border-color: color-mix(in srgb, var(--app-primary) 45%, var(--app-divider));
  box-shadow: 0 0 0 3px var(--app-primary-weak);
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
/* Aa 忽略大小写开关：开启态点亮 */
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
  transition: border-color 0.15s var(--app-ease), color 0.15s var(--app-ease), background 0.15s var(--app-ease);
}
.rule-editor__cond-case:hover {
  border-color: var(--app-primary);
  color: var(--app-primary);
}
.rule-editor__cond-case--on {
  border-color: color-mix(in srgb, var(--app-primary) 45%, transparent);
  background: var(--app-primary-weak);
  color: var(--app-primary);
}

/* ===========================================================================
   动作区
   =========================================================================== */
.rule-editor__branch-actions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--app-divider);
}
/* 「执行动作」小标题：等宽大写分隔标签 */
.rule-editor__actions-caption {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.rule-editor__actions-caption::after {
  content: '';
  flex: 1;
  height: 0;
  border-top: 1px dashed var(--app-divider);
}
.rule-editor__actions-caption-text {
  font-family: var(--app-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--app-text-3);
}
.rule-editor__group--action + .rule-editor__group--action {
  margin-top: 8px;
}
.rule-editor__group--action + .rule-editor__add,
.rule-editor__conds > .rule-editor__add {
  margin-top: 2px;
}

/* 动作选择：触发器占位（窄屏整行占满），点开为分组大卡片弹层 */
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

/* ===========================================================================
   添加按钮 / 分支添加 / JSON 面板
   =========================================================================== */
.rule-editor__add {
  height: 34px;
  letter-spacing: 0.02em;
}
.rule-editor__branch-add {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-left: 26px;
}
.rule-editor__json-frame {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius);
  background: var(--app-bg-soft);
  padding: 8px;
}
.rule-editor__json-frame :deep(.n-input) {
  --n-border: none !important;
  --n-border-hover: none !important;
  --n-border-focus: none !important;
  --n-box-shadow-focus: none !important;
  background: transparent;
}

/* ===========================================================================
   入场编排：分支卡片错峰上浮（reduced-motion 下由全局规则关闭）
   =========================================================================== */
@keyframes re-branch-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .rule-editor__branch {
    animation: re-branch-in 0.45s var(--app-ease) both;
    animation-delay: calc(var(--i, 0) * 70ms);
  }
  .rule-editor__branch-dot {
    animation: re-pulse 2.4s ease-in-out infinite;
  }
}

/* ===========================================================================
   移动端：轨道收起、条件行竖向堆叠、控件占满整行
   =========================================================================== */
@media (max-width: 767px) {
  .rule-editor__ladder {
    padding-left: 0;
  }
  .rule-editor__ladder::before,
  .rule-editor__branch::after {
    display: none;
  }
  .rule-editor__branch-add {
    padding-left: 0;
  }
  .rule-editor__cond-row {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .rule-editor__cond-target,
  .rule-editor__cond-op,
  .rule-editor__cond-name,
  .rule-editor__cond-values {
    width: 100%;
    flex: 1 1 auto;
    min-width: 0;
  }
  .rule-editor__cond-case {
    align-self: flex-start;
  }
  .rule-editor__cond-row > .n-button {
    align-self: flex-end;
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
  .rule-editor__branch {
    padding: 12px;
  }
  .rule-editor__branch-head {
    gap: 8px;
  }
  .rule-editor__group-head {
    gap: 6px;
  }
}
</style>
