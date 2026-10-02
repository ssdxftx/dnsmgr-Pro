<template>
  <div class="app-stack">
    <PageHeader :title="t('cache.title')" :subtitle="t('cache.subtitle')" />
    <n-card :bordered="false">
      <n-space vertical :size="16">
        <n-radio-group v-model:value="opType">
          <n-radio-button value="url">{{ t('cache.urlRefresh') }}</n-radio-button>
          <n-radio-button value="dir">{{ t('cache.dirRefresh') }}</n-radio-button>
          <n-radio-button value="preheat">{{ t('cache.preheat') }}</n-radio-button>
        </n-radio-group>

        <n-input
          v-model:value="urlText"
          type="textarea"
          :rows="6"
          :placeholder="placeholderText"
        />

        <n-space align="center">
          <n-button type="primary" :loading="submitting" @click="submit">{{ t('common.submit') }}</n-button>
          <n-text depth="3" style="font-size:12px">{{ t('cache.hint') }}</n-text>
        </n-space>

        <n-alert v-if="result.msg" :type="result.ok ? 'success' : 'warning'" :show-icon="false" :title="result.msg">
          <div v-for="(f, i) in result.failed" :key="i" style="font-size:12px">{{ f.url }}：{{ f.msg }}</div>
        </n-alert>
      </n-space>
    </n-card>

    <n-card :bordered="false" :title="t('cache.historyCard')" style="margin-top:12px">
      <ResponsiveDataTable
        :columns="columns"
        :data="tasks"
        :loading="loadingTasks"
        :pagination="{ pageSize: 20 }"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue';
import { NTag } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { api } from '../api';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const opType = ref<'url' | 'dir' | 'preheat'>('url');
const urlText = ref('');
const submitting = ref(false);
const loadingTasks = ref(false);
const tasks = ref<any[]>([]);
const result = ref<{ ok: boolean; msg: string; failed: { url: string; msg: string }[] }>({ ok: true, msg: '', failed: [] });

const placeholderText = computed(() => {
  if (opType.value === 'dir') return t('cache.dirPlaceholder');
  return t('cache.urlPlaceholder');
});

const typeName = computed<Record<string, string>>(() => ({
  url: t('cache.typeUrl'),
  dir: t('cache.typeDir'),
  preheat: t('cache.typePreheat'),
  preheat_: t('cache.typePreheat'),
}));
const typeTag: Record<string, string> = { url: 'info', dir: 'warning', preheat: 'success', preheat_: 'success' };

const columns = computed(() => [
  { title: 'URL', key: 'url', ellipsis: { tooltip: true } },
  {
    title: t('cache.typeCol'),
    key: 'type',
    width: 110,
    render: (row: any) => h(NTag, { size: 'small', type: (typeTag[row.type] || 'default') as any, bordered: false }, { default: () => typeName.value[row.type] || row.type }),
  },
  { title: t('cache.providerCol'), key: 'provider', width: 140 },
  {
    title: t('cache.statusCol'),
    key: 'status',
    width: 90,
    render: (row: any) => h(NTag, { size: 'small', type: row.status ? 'error' : 'success', bordered: false }, { default: () => (row.status ? t('cache.fail') : t('cache.success')) }),
  },
  { title: t('cache.msgCol'), key: 'msg', width: 160, ellipsis: { tooltip: true } },
  { title: t('cache.timeCol'), key: 'addtime', width: 180 },
]);

async function submit() {
  const urls = urlText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!urls.length) {
    result.value = { ok: false, msg: t('cache.emptyUrls'), failed: [] };
    return;
  }
  submitting.value = true;
  result.value = { ok: true, msg: '', failed: [] };
  try {
    let res: any;
    if (opType.value === 'preheat') {
      res = await api<any>('POST', '/cdn/preheat', { urls });
    } else {
      res = await api<any>('POST', '/cdn/purge', { type: opType.value, urls });
    }
    if (res.code !== 0) {
      result.value = { ok: false, msg: res.msg || t('cache.submitFailed'), failed: [] };
      return;
    }
    const success = res.success?.length || 0;
    const failed = res.failed || [];
    const action = opType.value === 'preheat' ? t('cache.typePreheat') : opType.value === 'dir' ? t('cache.typeDir') : t('cache.typeUrl');
    if (failed.length) {
      result.value = { ok: false, msg: t('cache.doneCount', { action, success, failed: failed.length }), failed };
    } else {
      result.value = { ok: true, msg: t('cache.submittedCount', { action, success }), failed: [] };
      urlText.value = '';
    }
    loadTasks();
  } finally {
    submitting.value = false;
  }
}

async function loadTasks() {
  loadingTasks.value = true;
  try {
    const res = await api<any>('GET', '/cdn/cache-tasks');
    if (res.code === 0) tasks.value = res.data || [];
  } finally {
    loadingTasks.value = false;
  }
}

onMounted(loadTasks);
</script>