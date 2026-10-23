<template>
  <div class="app-stack">
    <PageHeader :title="pageTitle" :subtitle="t('esaAccount.subtitle')" back="/cdn-accounts">
      <template #actions>
        <n-tag size="small" :bordered="false">{{ headerTag }}</n-tag>
      </template>
    </PageHeader>

    <div class="zone-toolbar">
      <n-button size="small" :loading="loadBusy" @click="reload">{{ t('cdnZoneSetting.refresh') }}</n-button>
      <ZoneModuleMenu
        :value="section"
        :sub-value="activeSub"
        :items="sectionItems"
        :aria-label="t('esaZone.switchPage')"
        @select="onSectionSelect"
      />
    </div>

    <EsaAccountConsole ref="consoleRef" v-model:section="section" :subs="subs" :aid="aid" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { NButton, NTag } from 'naive-ui';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import EsaAccountConsole from '../components/cdn/EsaAccountConsole.vue';
import ZoneModuleMenu, { type ZoneModuleMenuItem } from '../components/cdn/ZoneModuleMenu.vue';
import { ESA_ACCOUNT_TABS } from '../lib/zoneTabs';

const { t } = useI18n();
const route = useRoute();
const aid = Number(route.params.aid || 0);
const accountName = ref('');
const section = ref('overview');
const subs = reactive<Record<string, string>>({});
for (const tabDef of ESA_ACCOUNT_TABS) {
  if (tabDef.children?.length) subs[tabDef.key] = tabDef.defaultChild || tabDef.children[0].key;
}
const loadBusy = ref(false);
const consoleRef = ref<{ reload?: () => Promise<void> } | null>(null);

const sectionItems = computed<ZoneModuleMenuItem[]>(() =>
  ESA_ACCOUNT_TABS.map((item) => ({
    key: item.key,
    label: t(item.labelKey),
    defaultChild: item.defaultChild,
    children: item.children?.map((child) => ({
      key: child.key,
      label: child.labelKey ? t(child.labelKey) : child.label || child.key,
      gate: child.gate,
    })),
  })),
);
const activeSub = computed(() => subs[section.value] || '');

function onSectionSelect(key: string, sub?: string) {
  if (sub) subs[key] = sub;
  section.value = key;
}

async function reload() {
  loadBusy.value = true;
  try {
    await consoleRef.value?.reload?.();
  } finally {
    loadBusy.value = false;
  }
}

const pageTitle = computed(() => (accountName.value ? `${t('esaAccount.title')} · ${accountName.value}` : t('esaAccount.title')));
const headerTag = computed(() => (accountName.value ? `${accountName.value} · Aliyun ESA` : 'Aliyun ESA · 2024-09-10'));

onMounted(async () => {
  const res = await api<any>('GET', '/cdn/accounts');
  if (res.code !== 0) return;
  accountName.value = String((res.data || []).find((x: any) => Number(x.id) === aid)?.name || '');
});
</script>
