<template>
  <div class="app-stack">
    <PageHeader :title="pageTitle" :subtitle="t('cdnEsaApi.subtitle')" back="/cdn-accounts">
      <template #actions>
        <n-tag size="small" :bordered="false">{{ headerTag }}</n-tag>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <EsaApiConsole :aid="aid" />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NCard, NTag } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EsaApiConsole from '../components/cdn/EsaApiConsole.vue';

const { t } = useI18n();
const route = useRoute();
const aid = Number(route.params.aid || 0);
const accountName = ref('');
const pageTitle = computed(() => (accountName.value ? `${t('cdnEsaApi.title')} · ${accountName.value}` : t('cdnEsaApi.title')));
const headerTag = computed(() => (accountName.value ? `${accountName.value} · Aliyun ESA` : 'Aliyun ESA · 2024-09-10'));

onMounted(async () => {
  const res = await api<any>('GET', '/cdn/accounts');
  if (res.code !== 0) return;
  accountName.value = String((res.data || []).find((x: any) => Number(x.id) === aid)?.name || '');
});
</script>
