<template>
  <div class="app-stack">
    <PageHeader title="关于" subtitle="查看项目版本信息与更新状态" />
    <n-grid cols="1 l:2" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item>
        <n-card :bordered="false">
          <div class="app-head">
            <div class="app-logo">DNS</div>
            <div class="app-meta">
              <div class="app-name">
                <span>{{ info?.name || '彩虹 DNS Pro' }}</span>
                <n-tag type="success" size="small" round>v{{ info?.version || frontendVersion }}</n-tag>
              </div>
              <div class="app-desc">{{ info?.description || '项目信息加载中…' }}</div>
            </div>
          </div>

          <n-divider class="app-divider" />

          <n-descriptions :column="1" :label-placement="labelPlacement" size="small">
            <n-descriptions-item label="后端版本">{{ info?.version || '-' }}</n-descriptions-item>
            <n-descriptions-item label="前端版本">
              <span>{{ frontendVersion }}</span>
              <n-tag v-if="versionMismatch" type="warning" size="tiny" :bordered="false" class="inline-tag">与后端不一致</n-tag>
            </n-descriptions-item>
            <n-descriptions-item label="前端构建时间">{{ formatTime(buildTime) }}</n-descriptions-item>
            <n-descriptions-item label="运行环境">{{ runtimeText }}</n-descriptions-item>
            <n-descriptions-item label="已运行">{{ uptimeText }}</n-descriptions-item>
            <n-descriptions-item label="启动时间">{{ formatTime(info?.startedAt) }}</n-descriptions-item>
            <n-descriptions-item label="开源协议">{{ info?.license || '-' }}</n-descriptions-item>
            <n-descriptions-item label="项目仓库">
              <n-a :href="info?.repo || repoFallback" target="_blank" rel="noreferrer">{{ repoLabel }}</n-a>
            </n-descriptions-item>
          </n-descriptions>
        </n-card>
      </n-grid-item>

      <n-grid-item>
        <n-card :bordered="false">
          <template #header>
            <span>版本更新</span>
          </template>
          <template #header-extra>
            <n-button size="small" secondary :loading="checking" @click="check(true)">
              <template #icon><n-icon :component="RefreshOutline" /></template>
              检查更新
            </n-button>
          </template>

          <n-spin :show="loading">
            <div class="ver-row">
              <div class="ver-cell">
                <div class="ver-label">当前版本</div>
                <div class="ver-value">v{{ update?.current || info?.version || '-' }}</div>
              </div>
              <div class="ver-cell">
                <div class="ver-label">最新版本</div>
                <div class="ver-value">v{{ update?.latest || '—' }}</div>
              </div>
              <n-tag :type="statusType" size="small" round class="ver-tag">{{ statusText }}</n-tag>
            </div>

            <n-alert v-if="update?.error" type="warning" :show-icon="true" class="ver-alert">
              {{ update.error }}
            </n-alert>
            <n-alert v-else-if="update?.hasUpdate" type="success" :show-icon="true" class="ver-alert">
              发现新版本 v{{ update.latest }}，建议尽快升级。
            </n-alert>
            <n-alert v-else-if="update?.ahead" type="info" :show-icon="true" class="ver-alert">
              当前版本高于仓库最新标签，可能是开发版或尚未发布标签。
            </n-alert>
            <n-alert v-else type="default" :show-icon="true" class="ver-alert">
              已是最新版本。
            </n-alert>

            <div v-if="update?.hasUpdate && (update?.compareUrl || update?.releaseUrl)" class="ver-actions">
              <n-button v-if="update?.compareUrl" size="small" tag="a" :href="update.compareUrl" target="_blank" rel="noreferrer">
                查看更新内容
              </n-button>
              <n-button v-if="update?.releaseUrl" size="small" type="primary" tag="a" :href="update.releaseUrl" target="_blank" rel="noreferrer">
                前往下载
              </n-button>
            </div>

            <n-descriptions :column="1" :label-placement="labelPlacement" size="small" class="ver-detail">
              <n-descriptions-item label="发布时间">{{ formatTime(update?.publishedAt) }}</n-descriptions-item>
              <n-descriptions-item label="检查时间">{{ formatTime(update?.checkedAt) }}</n-descriptions-item>
              <n-descriptions-item label="更新源仓库">
                <n-a :href="updateRepoUrl" target="_blank" rel="noreferrer">{{ update?.repo || info?.updateRepo }}</n-a>
              </n-descriptions-item>
            </n-descriptions>

            <n-collapse v-if="update?.notes" class="ver-notes">
              <n-collapse-item title="更新说明" name="notes">
                <pre class="notes-body">{{ update.notes }}</pre>
              </n-collapse-item>
            </n-collapse>
          </n-spin>
        </n-card>
      </n-grid-item>
    </n-grid>

    <n-card :bordered="false" title="技术栈与致谢" class="stack-card">
      <div class="stack-block">
        <div class="stack-title">技术栈</div>
        <n-space :size="8" class="stack-tags">
          <n-tag v-for="item in stack" :key="item" size="small" :bordered="false" round>{{ item }}</n-tag>
        </n-space>
      </div>
      <div class="stack-block">
        <div class="stack-title">参考项目</div>
        <ul class="stack-list">
          <li>
            <n-a href="https://github.com/netcccyun/dnsmgr" target="_blank" rel="noreferrer">彩虹聚合 DNS 管理系统（彩虹 DNS）</n-a>
            <span class="stack-desc">：本项目的数据结构与功能原型</span>
          </li>
          <li>
            <n-a href="https://github.com/qingqian844/kuocaicdn_V1A" target="_blank" rel="noreferrer">阔彩 CDN（multi-cloud-cdn）</n-a>
            <span class="stack-desc">：CDN 域名管理与边缘规则引擎能力</span>
          </li>
        </ul>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NIcon, useMessage } from 'naive-ui';
import { RefreshOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';

interface AboutInfo {
  name: string;
  description: string;
  version: string;
  repo: string;
  license: string;
  updateRepo: string;
  node: string;
  platform: string;
  uptime: number;
  startedAt: string;
}

interface UpdateResult {
  current: string;
  latest: string | null;
  latestTag: string | null;
  hasUpdate: boolean;
  ahead: boolean;
  repo: string;
  releaseUrl: string | null;
  compareUrl: string | null;
  publishedAt: string | null;
  notes: string | null;
  checkedAt: string;
  cached: boolean;
  error: string | null;
}

const message = useMessage();
const frontendVersion = __APP_VERSION__;
const buildTime = __BUILD_TIME__;
const repoFallback = 'https://github.com/ssdxftx/dnsmgr-Pro';

const info = ref<AboutInfo | null>(null);
const update = ref<UpdateResult | null>(null);
const loading = ref(false);
const checking = ref(false);

const isMobile = ref(false);
function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));

const labelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));
const versionMismatch = computed(() => !!info.value && !!frontendVersion && info.value.version !== frontendVersion);
const runtimeText = computed(() => (info.value ? `${info.value.node} / ${info.value.platform}` : '-'));
const repoLabel = computed(() => String(info.value?.repo || repoFallback).replace(/^https?:\/\/github\.com\//, ''));
const updateRepoUrl = computed(() => `https://github.com/${update.value?.repo || info.value?.updateRepo || ''}`);
const uptimeText = computed(() => {
  const total = Number(info.value?.uptime || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
});

const statusText = computed(() => {
  if (!update.value) return '未检查';
  if (update.value.error) return '检查失败';
  if (update.value.hasUpdate) return '有新版本';
  if (update.value.ahead) return '开发版';
  return '已是最新';
});
const statusType = computed(() => {
  if (!update.value) return 'default';
  if (update.value.error) return 'warning';
  if (update.value.hasUpdate) return 'success';
  if (update.value.ahead) return 'info';
  return 'default';
});

const stack = ['TypeScript', 'Node.js', 'Fastify', 'Vue 3', 'Naive UI', 'Vite', 'MySQL'];

function formatTime(v?: string | null): string {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function loadInfo() {
  const res = await api<{ code: number; data: AboutInfo }>('GET', '/about');
  if (res.code === 0) info.value = res.data;
  else message.error(res.msg || '获取项目信息失败');
}

async function check(force = false) {
  checking.value = true;
  try {
    const res = await api<{ code: number; data: UpdateResult; msg?: string }>('POST', '/about/check-update', { force: force ? 1 : 0 });
    if (res.code === 0) {
      update.value = res.data;
      if (!res.data.error && res.data.hasUpdate) message.success(`发现新版本 v${res.data.latest}`);
    } else {
      message.error(res.msg || '检查更新失败');
    }
  } finally {
    checking.value = false;
    loading.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  await loadInfo();
  await check(false);
});
</script>

<style scoped>
.app-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.app-logo {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b6df0, #6f9bff);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 1px;
}
.app-meta {
  min-width: 0;
}
.app-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
  flex-wrap: wrap;
}
.app-desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--app-text-3);
}
.app-divider {
  margin: 16px 0;
}
.inline-tag {
  margin-left: 6px;
}
.ver-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ver-cell {
  flex: 1 1 120px;
  min-width: 0;
}
.ver-label {
  font-size: 12px;
  color: var(--app-text-3);
}
.ver-value {
  margin-top: 2px;
  font-size: 18px;
  font-weight: 600;
  word-break: break-all;
}
.ver-tag {
  flex: none;
}
.ver-alert {
  margin-top: 14px;
}
.ver-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.ver-detail {
  margin-top: 14px;
}
.ver-notes {
  margin-top: 8px;
}
.notes-body {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.7;
  color: #4b5563;
}
.stack-card {
  margin-top: 16px;
}
.stack-block + .stack-block {
  margin-top: 16px;
}
.stack-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.stack-tags {
  width: 100%;
}
.stack-list {
  margin: 0;
  padding-left: 20px;
  line-height: 1.8;
  color: #4b5563;
}
.stack-desc {
  margin: 0;
  line-height: 1.8;
  color: #4b5563;
  font-size: 13px;
}

@media (max-width: 768px) {
  .app-logo {
    width: 42px;
    height: 42px;
    font-size: 13px;
  }
  .ver-value {
    font-size: 16px;
  }
  .ver-actions {
    width: 100%;
  }
  .ver-actions :deep(.n-button) {
    flex: 1;
  }
  .stack-list {
    padding-left: 18px;
    word-break: break-word;
  }
}
</style>
