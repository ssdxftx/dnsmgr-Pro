<template>
  <div class="app-stack">
    <PageHeader :title="(isEdit ? t('common.edit') : t('common.add')) + ' ' + t('optimize.taskTitle')" :subtitle="t('optimize.formSubtitle')" back="/optimize-tasks" />
    <n-card :bordered="false">
      <n-form label-placement="left" label-width="110" style="max-width: 720px">
        <n-form-item :label="t('optimize.domainSelect')" required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" :placeholder="t('optimize.hostRecord')" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" :placeholder="t('optimize.mainDomain')" filterable style="flex: 1" />
          </n-space>
        </n-form-item>

        <n-form-item :label="t('optimize.cdnProvider')" required>
          <n-radio-group v-model:value="form.cdn_type">
            <n-radio-button v-for="(v, k) in cdnTypeList" :key="k" :value="Number(k)">{{ v }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item :label="t('optimize.typeSelect')" required>
          <n-radio-group v-model:value="form.type">
            <n-radio-button :value="0">
              {{ t('optimize.lineType0') }}
              <n-tooltip trigger="hover">{{ t('optimize.lineType0Tip') }}</n-tooltip>
            </n-radio-button>
            <n-radio-button :value="1">
              {{ t('optimize.lineType1') }}
              <n-tooltip trigger="hover">{{ t('optimize.lineType1Tip') }}</n-tooltip>
            </n-radio-button>
          </n-radio-group>
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

        <n-alert v-show="form.type === 0" type="info" style="margin-bottom: 12px">
          {{ t('optimize.alertType0') }}
        </n-alert>
        <n-alert v-show="form.type === 1" type="info" style="margin-bottom: 12px">
          {{ t('optimize.alertType1') }}
        </n-alert>

        <n-form-item>
          <n-button type="primary" :loading="saving" @click="submit">{{ t('common.submit') }}</n-button>
        </n-form-item>
      </n-form>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
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
const saving = ref(false);
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
  form.ip_type = ipTypeSelect.value.join(',') || 'v4';
}

async function loadDomains() {
  const res = await api<any>('GET', '/optimize/domains');
  if (res.code === 0) domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id }));
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
  if (!form.did || !form.rr || !form.ip_type || !form.recordnum || !form.ttl) {
    return message.warning(t('optimize.requiredEmpty'));
  }
  saving.value = true;
  const body = { ...form, ip_type: ipTypeSelect.value.join(',') };
  const res = isEdit.value ? await api('PUT', `/optimize/tasks/${editId.value}`, body) : await api('POST', '/optimize/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push('/optimize-tasks');
  } else message.error(res.msg);
}

onMounted(async () => {
  await loadSettings();
  await loadDomains();
  if (isEdit.value) await loadTask();
});
</script>

<style scoped>
.tip-text {
  color: var(--app-text-3);
  font-size: 12px;
}
</style>