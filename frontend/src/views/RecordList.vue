<template>
  <div class="app-stack">
    <PageHeader :title="t('record.title', { title: displayTitle })" :subtitle="t('record.subtitle')" back="/domains">
      <template #actions>
        <n-space>
          <n-button v-if="accountType === 'cloudflare' && isAdmin" type="info" @click="router.push(`/cloudflare/domains/${domainId}/hostnames`)">{{ t('record.customHostnames') }}</n-button>
          <n-button v-if="accountType === 'cloudflare' && isAdmin" type="primary" secondary @click="router.push(`/cf-rules?domain=${domainId}`)">{{ t('record.rulesEngine') }}</n-button>
          <n-button v-if="access.writable" type="primary" @click="recordTable?.openAdd()">
            <template #icon><n-icon :component="AddOutline" /></template>
            {{ t('record.addRecord') }}
          </n-button>
        </n-space>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <RecordTable
        ref="recordTable"
        :records="records"
        :loading="loading"
        :pagination="pagination"
        :domain-id="domainId"
        :domain-name="domainName"
        :access="access"
        :domain-index="domainIndex"
        :sub-filter="subFilter"
        @refresh="loadRecords"
      />
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NSpace, useMessage } from 'naive-ui';
import { AddOutline } from '@vicons/ionicons5';
import { api, getUser } from '../api';
import PageHeader from '../components/PageHeader.vue';
import RecordTable from '../components/RecordTable.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const message = useMessage();
const domainId = Number(route.params.id);
const domainName = ref('');
const accountType = ref('');
const isAdmin = computed(() => (getUser()?.level || 0) >= 2);
const subFilter = computed(() => (route.query.sub as string) || '');
const displayTitle = computed(() => {
  if (!domainName.value) return t('record.domainFallback', { id: domainId });
  return subFilter.value ? `${subFilter.value}.${domainName.value}` : domainName.value;
});
const access = ref<{ admin: boolean; readonly: boolean; writable: boolean }>({ admin: true, readonly: false, writable: true });
const domainIndex = ref<Record<string, { id: number; sub: string }>>({});
const recordTable = ref<InstanceType<typeof RecordTable> | null>(null);

const loading = ref(false);
const records = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const pagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  onChange: (p: number) => {
    page.value = p;
    loadRecords();
  },
}));

async function loadRecords() {
  loading.value = true;
  const res = await api<any>('GET', `/domains/${domainId}/records`, { page: page.value, pagesize: pageSize.value, subdomain: subFilter.value || undefined });
  if (res.code === 0) {
    records.value = res.data.list;
    total.value = res.data.total;
    domainName.value = res.data.list?.[0]?.Domain || domainName.value;
    access.value = res.data._access || { admin: true, readonly: false, writable: true };
  } else {
    message.error(res.msg);
  }
  loading.value = false;
}

async function loadDomainInfo() {
  const res = await api<any>('GET', '/domains');
  if (res.code === 0) {
    const list: any[] = res.data || [];
    // 管理员可跳转到独立纳管的子域名；普通用户可跳转到被授权的子域名范围（name 形如 user1.example.com）
    const index: Record<string, { id: number; sub: string }> = {};
    for (const d of list) {
      const key = String(d.name || '').toLowerCase();
      if (key && !index[key]) index[key] = { id: d.id, sub: d._sub || '' };
    }
    domainIndex.value = index;
    const d = list.find((x: any) => x.id === domainId);
    if (d) {
      domainName.value = d._base_name || d.name;
      accountType.value = d.account_type || '';
    }
  }
}

onMounted(() => {
  loadRecords();
  loadDomainInfo();
});
</script>