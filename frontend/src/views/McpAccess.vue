<template>
  <div class="app-stack">
    <PageHeader :title="t('mcp.title')" :subtitle="t('mcp.subtitle')" />
    <n-card :bordered="false" :title="t('mcp.title')" size="small" style="max-width:920px">
      <template #header-extra>
        <n-button size="small" quaternary type="primary" @click="router.push('/preferences')">
          {{ t('mcp.manageKeys') }}
        </n-button>
      </template>
      <p class="mcp-hint">{{ t('mcp.hint') }}</p>
      <n-form label-placement="top">
        <n-form-item :label="t('mcp.endpoint')">
          <n-input :value="mcpUrl" readonly />
        </n-form-item>
      </n-form>
      <div class="mcp-block">
        <div class="mcp-block-head">
          <span>{{ t('mcp.apiKeyMode') }}</span>
          <n-button size="tiny" quaternary type="primary" @click="copy(mcpApiConfig)">{{ t('mcp.copy') }}</n-button>
        </div>
        <pre class="mcp-config">{{ mcpApiConfig }}</pre>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui';
import PageHeader from '../components/PageHeader.vue';

const { t } = useI18n();
const router = useRouter();
const message = useMessage();

const mcpUrl = computed(() => `${window.location.origin}/mcp`);
const mcpApiConfig = computed(() => JSON.stringify({ mcpServers: { dnsmgr: { url: mcpUrl.value, headers: { 'X-API-Key': '<YOUR_API_KEY>' } } } }, null, 2));

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(t('mcp.copied'));
  } catch {
    message.warning(t('mcp.copyManual'));
  }
}
</script>

<style scoped>
.mcp-hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--app-text-3);
}
.mcp-block {
  margin-top: 14px;
}
.mcp-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}
.mcp-config {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  border-radius: 8px;
  background: var(--app-fill-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
}
</style>
