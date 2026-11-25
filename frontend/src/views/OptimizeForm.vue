<template>
  <div class="app-stack">
    <PageHeader :title="(isEdit ? t('common.edit') : t('common.add')) + ' ' + t('optimize.taskTitle')" :subtitle="t('optimize.formSubtitle')" back="/optimize-tasks" />
    <n-alert v-if="initError" type="error" :show-icon="false">
      <div class="load-error">
        <span>{{ t('common.loadFailedHint') }}</span>
        <n-button size="small" :loading="initBusy" @click="loadInitial">{{ t('common.retry') }}</n-button>
      </div>
    </n-alert>
    <n-card :bordered="false">
      <n-form label-placement="left" label-width="110" style="max-width: 720px">
        <n-form-item :label="t('optimize.domainSelect')" required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" :placeholder="t('optimize.hostRecord')" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" :placeholder="t('optimize.mainDomain')" filterable remote :loading="domainLoadBusy" @search="onDomainSearch" style="flex: 1" />
          </n-space>
        </n-form-item>

        <n-form-item :label="t('optimize.cdnProvider')" required>
          <n-radio-group v-model:value="form.cdn_type">
            <n-radio-button v-for="(v, k) in cdnTypeList" :key="k" :value="Number(k)">{{ v }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item :label="t('optimize.typeSelect')" required>
          <div style="width: 100%">
            <n-radio-group v-model:value="form.type">
              <n-radio-button :value="0">{{ t('optimize.lineType0') }}</n-radio-button>
              <n-radio-button :value="1">{{ t('optimize.lineType1') }}</n-radio-button>
            </n-radio-group>
            <p class="hint-text" style="margin: 6px 0 0">
              {{ form.type === 0 ? t('optimize.lineType0Tip') : t('optimize.lineType1Tip') }}
            </p>
          </div>
        </n-form-item>

        <n-form-item :label="t('optimize.ipTypeSelect')" required>
          <n-space>
            <n-checkbox v-for="o in ipTypeList" :key="o.value" :checked="ipTypeSelect.includes(o.value)" :disabled="o.value === 'v6' && isXingpingcn" @update:checked="(v: boolean) => toggleIpType(o.value, v)">
              {{ o.label }}<span v-if="o.value === 'v6' && isXingpingcn" class="tip-text">{{ t('optimize.ipV6Unsupported') }}</span>
            </n-checkbox>
          </n-space>
        </n-form-item>

        <n-form-item :label="t('optimize.perLine')" required>
          <n-input-number v-model:value="form.recordnum" :min="1" :max="50" style="width: 220px" />
        </n-form-item>

        <n-form-item label="TTL" required>
          <n-input-number v-model:value="form.ttl" :min="1" :max="3600" style="width: 220px" />
        </n-form-item>

        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('optimize.optional')" />
        </n-form-item>

        <n-alert v-show="form.type === 0" type="info" class="mb-3">
          {{ t('optimize.alertType0') }}
        </n-alert>
        <n-alert v-show="form.type === 1" type="info" class="mb-3">
          {{ t('optimize.alertType1') }}
        </n-alert>

        <n-form-item>
          <n-button type="primary" :loading="saveBusy" @click="submit">{{ t('common.submit') }}</n-button>
        </n-form-item>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const { t } = useI18n();

const isEdit = computed(() => !!route.params.id && route.path.includes('/edit'));
const editId = computed(() => Number(route.params.id));

const domainOptions = ref<any[]>([]);
const domainLoadBusy = ref(false);
const saveBusy = ref(false);
const initBusy = ref(false);
const initError = ref(false);
const optimizeIpApi = ref('0');
const ipTypeSelect = ref<string[]>(['v4']);

const cdnTypeList: Record<number, string> = { 1: 'CloudFlare', 2: 'CloudFront', 4: 'EdgeOne' };
const ipTypeList = computed(() => [
  { value: 'v4', label: t('optimize.ipTypeV4') },
  { value: 'v6', label: t('optimize.ipTypeV6') },
]);

const isXingpingcn = computed(() => optimizeIpApi.value === '2');

const form = reactive<any>({
  rr: '',
  did: null,
  type: 0,
  cdn_type: 1,
  ip_type: 'v4',
  recordnum: 2,
  ttl: 600,
  remark: '',
});

function toggleIpType(v: string, checked: boolean) {
  if (checked) {
    if (v === 'v6' && isXingpingcn.value) return;
    if (!ipTypeSelect.value.includes(v)) ipTypeSelect.value.push(v);
  } else {
    ipTypeSelect.value = ipTypeSelect.value.filter((x) => x !== v);
  }
  form.ip_type = ipTypeSelect.value.join(',');
}

let domainSearchTimer: number | undefined;
let domainSearchSeq = 0;
function onDomainSearch(kw: string) {
  if (domainSearchTimer) window.clearTimeout(domainSearchTimer);
  // 250ms 防抖：避免每输入一个字符就发一次远程搜索
  domainSearchTimer = window.setTimeout(() => void loadDomains(kw), 250);
}

onBeforeUnmount(() => {
  if (domainSearchTimer) window.clearTimeout(domainSearchTimer);
  // 让已发出的请求结果失效，避免卸载后继续更新组件状态
  domainSearchSeq++;
});

async function loadDomains(kw = '') {
  const seq = ++domainSearchSeq;
  domainLoadBusy.value = true;
  try {
    const res = await api<any>('GET', '/optimize/domains', kw ? { kw } : undefined);
    if (seq !== domainSearchSeq) return;
    if (res.code === 0) domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id }));
  } finally {
    if (seq === domainSearchSeq) domainLoadBusy.value = false;
  }
}

async function loadSettings() {
  const res = await api<any>('GET', '/optimize/settings');
  if (res.code === 0) optimizeIpApi.value = res.data.optimize_ip_api;
}

async function loadTask() {
  const res = await api<any>('GET', `/optimize/tasks/${editId.value}`);
  if (res.code === 0) {
    const t = res.data;
    form.rr = t.rr;
    form.did = t.did;
    form.type = t.type;
    form.cdn_type = t.cdn_type;
    form.ip_type = t.ip_type;
    form.recordnum = t.recordnum;
    form.ttl = t.ttl;
    form.remark = t.remark || '';
    ipTypeSelect.value = String(t.ip_type || 'v4').split(',').filter(Boolean);
  } else message.error(res.msg);
}

async function submit() {
  // 校验实际提交的 ipTypeSelect（body 用其 join 结果），避免全部取消后仍提交空值
  if (!form.did || !form.rr || !ipTypeSelect.value.length || !form.recordnum || !form.ttl) {
    return message.warning(t('optimize.requiredEmpty'));
  }
  saveBusy.value = true;
  try {
    const body = { ...form, ip_type: ipTypeSelect.value.join(',') };
    const res = isEdit.value ? await api('PUT', `/optimize/tasks/${editId.value}`, body) : await api('POST', '/optimize/tasks', body);
    if (res.code === 0) {
      message.success(res.msg);
      router.push('/optimize-tasks');
    } else message.error(res.msg);
  } catch (e: any) {
    message.error(e?.message || t('common.networkError'));
  } finally {
    saveBusy.value = false;
  }
}

async function loadInitial() {
  initBusy.value = true;
  initError.value = false;
  try {
    await Promise.all([
      loadSettings().catch((e: any) => {
        initError.value = true;
        message.error(e?.message || t('common.networkError'));
      }),
      loadDomains().catch((e: any) => {
        initError.value = true;
        message.error(e?.message || t('common.networkError'));
      }),
    ]);
    if (isEdit.value) {
      await loadTask().catch((e: any) => {
        initError.value = true;
        message.error(e?.message || t('common.networkError'));
      });
    }
  } finally {
    initBusy.value = false;
  }
}

onMounted(loadInitial);
</script>

<style scoped>
.load-error {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tip-text {
  color: var(--app-text-3);
  font-size: 12px;
}
</style>