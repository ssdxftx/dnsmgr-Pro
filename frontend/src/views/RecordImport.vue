<template>
  <div class="app-stack">
    <PageHeader :title="t('record.importTitle', { name: domainName || '#' + domainId })" :subtitle="t('record.importSubtitle')" :back="`/domains/${domainId}/records`" />
    <n-card :bordered="false">
      <n-form label-placement="left" label-width="110">
        <n-form-item :label="t('record.recordType')">
          <n-select v-model:value="form.type" :options="typeOptions" clearable :placeholder="t('record.autoType')" style="width: 220px" />
        </n-form-item>
        <n-form-item :label="t('record.line')">
          <n-select v-model:value="form.line" :options="lineOptions" filterable style="width: 220px" />
        </n-form-item>
        <n-form-item label="TTL"><n-input-number v-model:value="form.ttl" :min="1" /></n-form-item>
        <n-form-item :label="t('record.priority')"><n-input-number v-model:value="form.mx" :min="0" /></n-form-item>
        <n-form-item :label="t('common.remark')"><n-input v-model:value="form.remark" /></n-form-item>
        <n-form-item :label="t('record.importRecordsLabel')">
          <n-input v-model:value="form.record" type="textarea" :rows="10" :placeholder="t('record.importPlaceholder')" />
        </n-form-item>
      </n-form>
      <n-space justify="end">
        <n-button @click="router.push(`/domains/${domainId}/records`)">{{ t('common.cancel') }}</n-button>
        <n-button type="primary" :loading="saving" @click="doImport">{{ t('domain.importSelected') }}</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NCard, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpace, useMessage } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const message = useMessage();
const domainId = Number(route.params.id);
const domainName = ref('');
const saving = ref(false);
const lines = ref<Record<string, string>>({});
const form = reactive<any>({ type: null, line: 'default', ttl: 600, mx: 1, remark: '', record: '' });
const typeOptions = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'REDIRECT_URL', 'FORWARD_URL'].map((v) => ({ label: v, value: v }));
const lineOptions = computed(() => Object.entries(lines.value).map(([name, code]) => ({ label: name, value: code })));

onMounted(async () => {
  const dl = await api<any>('GET', '/domains');
  if (dl.code === 0) {
    const d = (dl.data || []).find((x: any) => x.id === domainId);
    if (d) domainName.value = d._base_name || d.name;
  }
  const lr = await api<any>('GET', `/domains/${domainId}/lines`);
  if (lr.code === 0) {
    lines.value = lr.data || {};
    const def = Object.values(lines.value)[0];
    if (def) form.line = def;
  }
});

async function doImport() {
  if (!String(form.record || '').trim()) return message.warning(t('record.fillRequired'));
  saving.value = true;
  const res = await api('POST', `/domains/${domainId}/records/batch-add`, {
    record: form.record,
    type: form.type || '',
    line: form.line,
    ttl: form.ttl,
    mx: form.mx,
    remark: form.remark,
  });
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push(`/domains/${domainId}/records`);
  } else message.error(res.msg);
}
</script>