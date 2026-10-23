<template>
  <div class="esa-act">
    <div class="esa-act__hint">
      {{ L('执行动作按官方控制台分组展示；开启卡片后填写该动作的配置。', 'Actions follow the official console grouping. Enable a card to configure it.') }}
    </div>

    <div class="esa-act__grid">
      <section
        v-for="a in actions"
        :key="a.key"
        class="esa-act__card"
        :class="{ 'esa-act__card--on': isOn(a) }"
      >
        <header class="esa-act__head">
          <div class="esa-act__title-wrap">
            <span class="esa-act__title">{{ label(a.label) }}</span>
            <span class="esa-act__desc">{{ label(a.desc) }}</span>
          </div>
          <n-switch
            v-if="a.toggleField"
            :value="isOn(a)"
            size="small"
            @update:value="(v: boolean) => setOn(a, v)"
          />
          <n-tag v-else size="tiny" :bordered="false" type="info">{{ L('始终生效', 'Always on') }}</n-tag>
        </header>

        <div v-if="isOn(a)" class="esa-act__body">
          <n-form label-placement="left" :label-width="isMobile ? undefined : 150" size="small">
            <n-form-item
              v-for="f in fieldsOf(a)"
              :key="f.name"
              :label="fieldLabel(f)"
              :required="!!f.required"
              :label-placement="cardEnum(f) ? 'top' : undefined"
              :label-props="f.desc ? { title: f.desc } : undefined"
            >
              <EsaCardSelect
                v-if="f.type === 'enum' && cardEnum(f)"
                :model-value="model[f.name] ?? null"
                :options="enumCardOptions(f)"
                compact
                clearable
                @update:model-value="(v: any) => setField(f.name, v)"
              />
              <RuleFieldControl v-else :field="f" :model-value="model[f.name]" @update:model-value="(v: any) => setField(f.name, v)" />
            </n-form-item>
            <div v-if="!fieldsOf(a).length" class="hint-text">{{ L('该动作没有可配置字段。', 'This action has no configurable fields.') }}</div>
          </n-form>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NForm, NFormItem, NSwitch, NTag } from 'naive-ui';
import RuleFieldControl from './RuleFieldControl.vue';
import EsaCardSelect from './EsaCardSelect.vue';
import { useResponsive } from '../../composables/useResponsive';
import { ESA_RULE_KIND_META, type EsaActionMeta, type EsaLocale } from '../../lib/esaRuleMeta';

const props = withDefaults(
  defineProps<{
    kind: string;
    schema: any[];
    modelValue: Record<string, any>;
    locale?: EsaLocale;
  }>(),
  { locale: 'zh' },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, any>): void }>();

const { isMobile } = useResponsive();
const locale = computed(() => props.locale);
const L = (zh: string, en: string) => (locale.value === 'zh' ? zh : en);
const label = (b: { zh: string; en: string }) => (locale.value === 'zh' ? b.zh : b.en);

const model = computed(() => props.modelValue || {});
const meta = computed(() => ESA_RULE_KIND_META.find((k) => k.kind === props.kind));
const actions = computed<EsaActionMeta[]>(() => meta.value?.actions || []);
const fieldMap = computed<Record<string, any>>(() => {
  const map: Record<string, any> = {};
  for (const f of props.schema || []) map[f.name] = f;
  return map;
});

function fieldsOf(a: EsaActionMeta) {
  return a.fields.map((n) => fieldMap.value[n]).filter(Boolean);
}
function isOn(a: EsaActionMeta) {
  if (!a.toggleField) return true;
  return model.value[a.toggleField] === 'on';
}
function setOn(a: EsaActionMeta, v: boolean) {
  if (!a.toggleField) return;
  const next = { ...model.value, [a.toggleField]: v ? 'on' : 'off' };
  // 开启时补齐字段默认值，避免提交空结构
  if (v) {
    for (const f of fieldsOf(a)) {
      if (next[f.name] === undefined || next[f.name] === null || next[f.name] === '') {
        if (f.type === 'switch') next[f.name] = 'off';
        else if (f.type === 'enum' && Array.isArray(f.choices) && f.choices.length) next[f.name] = f.choices[0];
        else if (f.type === 'array') next[f.name] = [];
      }
    }
  }
  emit('update:modelValue', next);
}
function setField(name: string, v: any) {
  emit('update:modelValue', { ...model.value, [name]: v });
}
function fieldLabel(f: any) {
  // 官方中文名优先；英文界面回退到参数名
  return locale.value === 'zh' ? f.label || f.name : f.name;
}

const ENUM_LABELS: Record<string, { zh: string; en: string }> = {
  cache_all: { zh: '缓存所有请求', en: 'Cache all requests' },
  bypass_all: { zh: '所有请求绕过缓存', en: 'Bypass cache for all requests' },
  no_cache: { zh: '不缓存', en: 'Do not cache' },
  follow_origin: { zh: '遵循源站', en: 'Honor origin' },
  override_origin: { zh: '自定义 TTL', en: 'Use custom TTL' },
  follow_origin_bypass: { zh: '遵循源站，否则不缓存', en: 'Honor origin, else bypass' },
  follow_origin_override: { zh: '遵循源站，否则自定义', en: 'Honor origin, else custom' },
  ignore_all: { zh: '忽略全部', en: 'Ignore all' },
  exclude_query_string: { zh: '忽略指定参数', en: 'Ignore specific parameters' },
  reserve_all: { zh: '保留全部', en: 'Retain all' },
  include_query_string: { zh: '保留指定参数', en: 'Retain specific parameters' },
  bypass_cache_reserve: { zh: '绕过 Cache Reserve', en: 'Bypass Cache Reserve' },
  eligible_for_cache_reserve: { zh: '符合 Cache Reserve 资格', en: 'Eligible for Cache Reserve' },
  md5: { zh: '对请求体取 MD5 加入缓存键', en: 'MD5 request body into cache key' },
  ignore: { zh: '忽略请求体', en: 'Ignore request body' },
  static: { zh: '静态', en: 'Static' },
  dynamic: { zh: '动态', en: 'Dynamic' },
  add: { zh: '新增', en: 'Add' },
  modify: { zh: '修改', en: 'Modify' },
  del: { zh: '删除', en: 'Delete' },
  on: { zh: '开启', en: 'On' },
  off: { zh: '关闭', en: 'Off' },
  follow_client: { zh: '跟随客户端', en: 'Match client' },
  http: { zh: 'HTTP', en: 'HTTP' },
  https: { zh: 'HTTPS', en: 'HTTPS' },
};

const ENUM_DESCS: Record<string, { zh: string; en: string }> = {
  cache_all: { zh: '所有请求都进入缓存。', en: 'Cache all requests.' },
  bypass_all: { zh: '所有请求直接回源，不读取缓存。', en: 'Bypass cache for all requests.' },
  no_cache: { zh: '不缓存，每次都回源获取最新内容。', en: 'Do not cache; always fetch from origin.' },
  follow_origin: { zh: '遵循源站返回的缓存策略。', en: 'Honor the cache policy returned by the origin.' },
  override_origin: { zh: '忽略源站策略，使用自定义缓存时长。', en: 'Ignore origin policy and use a custom TTL.' },
  follow_origin_bypass: { zh: '源站有缓存策略时遵循，否则不缓存。', en: 'Honor origin policy when present, otherwise bypass.' },
  follow_origin_override: { zh: '源站有缓存策略时遵循，否则使用自定义时长。', en: 'Honor origin policy when present, otherwise use custom TTL.' },
  ignore_all: { zh: '生成缓存键时忽略全部查询参数。', en: 'Ignore all query parameters in the cache key.' },
  exclude_query_string: { zh: '生成缓存键时忽略指定的查询参数。', en: 'Ignore specified query parameters in the cache key.' },
  reserve_all: { zh: '生成缓存键时保留全部查询参数。', en: 'Retain all query parameters in the cache key.' },
  include_query_string: { zh: '生成缓存键时只保留指定的查询参数。', en: 'Retain only specified query parameters in the cache key.' },
  bypass_cache_reserve: { zh: '回源时绕过缓存保持节点。', en: 'Bypass Cache Reserve nodes when fetching from origin.' },
  eligible_for_cache_reserve: { zh: '允许响应进入缓存保持节点。', en: 'Allow responses to be stored in Cache Reserve.' },
  md5: { zh: '对请求体计算 MD5 并加入缓存键。', en: 'Add an MD5 of the request body to the cache key.' },
  ignore: { zh: '生成缓存键时忽略请求体。', en: 'Ignore the request body in the cache key.' },
  static: { zh: '按静态资源方式处理。', en: 'Treat as static content.' },
  dynamic: { zh: '按动态资源方式处理。', en: 'Treat as dynamic content.' },
};

/** 枚举统一用卡片展示，让每项含义直接可见；选项较多时面板内自动提供搜索。 */
function cardEnum(f: any) {
  return Array.isArray(f.choices) && f.choices.length > 0;
}

function enumCardOptions(f: any) {
  return (Array.isArray(f.choices) ? f.choices : []).map((c: string) => {
    const m = ENUM_LABELS[c];
    const d = ENUM_DESCS[c];
    return { label: m ? label(m) : c, value: c, desc: d ? label(d) : undefined };
  });
}
</script>

<style scoped>
.esa-act {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.esa-act__hint {
  font-size: 12px;
  color: var(--app-text-3);
}
.esa-act__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}
.esa-act__card {
  border: 1px solid var(--app-divider);
  border-radius: var(--app-radius-lg);
  background: var(--app-surface);
  padding: 12px 14px;
  transition: border-color 0.18s var(--app-ease), box-shadow 0.18s var(--app-ease);
}
.esa-act__card--on {
  border-color: color-mix(in srgb, var(--app-primary) 35%, var(--app-border));
  box-shadow: var(--app-shadow-sm);
}
.esa-act__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.esa-act__title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.esa-act__title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--app-text-1);
}
.esa-act__desc {
  font-size: 12px;
  line-height: 1.55;
  color: var(--app-text-3);
}
.esa-act__body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--app-divider);
}
</style>
