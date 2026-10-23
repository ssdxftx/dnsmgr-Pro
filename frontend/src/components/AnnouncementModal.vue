<template>
  <n-modal
    :show="show"
    preset="card"
    :title="t('announcement.modalTitle')"
    class="modal-md announcement-modal"
    :mask-closable="false"
    :auto-focus="false"
    @update:show="onShow"
  >
    <div class="announcement-list">
      <article v-for="item in visible" :key="item.id" class="announcement-item" :class="`is-${item.type}`">
        <div class="announcement-item__head">
          <span class="announcement-item__dot" aria-hidden="true" />
          <h3 class="announcement-item__title">{{ item.title }}</h3>
          <n-button quaternary circle size="tiny" :aria-label="t('common.close')" @click="dismiss(item)">
            <template #icon><n-icon :component="CloseOutline" /></template>
          </n-button>
        </div>
        <div class="announcement-item__content">{{ item.content }}</div>
        <div class="announcement-item__foot">
          <span v-if="itemTime(item)" class="announcement-item__time">{{ t('announcement.updatedAt', { time: itemTime(item) }) }}</span>
          <n-button size="small" type="primary" secondary @click="dismiss(item)">{{ t('announcement.confirm') }}</n-button>
        </div>
      </article>
    </div>
    <template v-if="visible.length > 1" #footer>
      <n-space justify="end">
        <n-button @click="dismissAll">{{ t('announcement.closeAll') }}</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NIcon } from 'naive-ui';
import { CloseOutline } from '@vicons/ionicons5';
import { useI18n } from 'vue-i18n';
import { api } from '../api';

interface Announcement {
  id: number;
  title: string;
  content: string;
  type?: string;
  addtime?: string;
  updatetime?: string;
}

const { t } = useI18n();
const STORAGE_KEY = 'dnsmgr_announcement_read';
const TYPES = new Set(['info', 'success', 'warning', 'error']);

const show = ref(false);
const visible = ref<Announcement[]>([]);

function readMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage 不可用时仅在当前页面关闭 */
  }
}

function versionOf(item: Announcement): string {
  return String(item.updatetime || item.addtime || '');
}

function itemTime(item: Announcement): string {
  const v = item.updatetime || item.addtime;
  return v ? String(v).replace('T', ' ').slice(0, 16) : '';
}

function markRead(items: Announcement[]) {
  const map = readMap();
  for (const item of items) map[String(item.id)] = versionOf(item);
  writeMap(map);
}

function dismiss(item: Announcement) {
  markRead([item]);
  visible.value = visible.value.filter((x) => x.id !== item.id);
  if (!visible.value.length) show.value = false;
}

function dismissAll() {
  markRead(visible.value);
  visible.value = [];
  show.value = false;
}

// 点击弹窗右上角关闭/按 Esc 也视为已读，避免下次进入再次弹出
function onShow(value: boolean) {
  if (value) {
    show.value = true;
    return;
  }
  if (visible.value.length) dismissAll();
  else show.value = false;
}

onMounted(async () => {
  try {
    const res = await api<any>('GET', '/announcements', undefined, { cache: false });
    if (res.code !== 0 || !Array.isArray(res.data)) return;
    const read = readMap();
    visible.value = res.data
      .filter((item: any) => item && Number(item.id) > 0 && item.title && item.content)
      .map((item: any) => ({
        ...item,
        type: TYPES.has(String(item.type)) ? String(item.type) : 'info',
      }))
      .filter((item: Announcement) => read[String(item.id)] !== versionOf(item));
    show.value = visible.value.length > 0;
  } catch {
    /* 公告加载失败不影响登录/仪表盘 */
  }
});
</script>

<style scoped>
.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(60vh, 560px);
  overflow-y: auto;
  padding-right: 2px;
}

.announcement-item {
  --announcement-accent: var(--app-primary);
  position: relative;
  padding: 14px 16px;
  border: 1px solid var(--app-border);
  border-left: 3px solid var(--announcement-accent);
  border-radius: var(--app-radius);
  background: var(--app-surface-2);
}
.announcement-item.is-info { --announcement-accent: var(--app-primary); }
.announcement-item.is-success { --announcement-accent: var(--app-success); }
.announcement-item.is-warning { --announcement-accent: var(--app-warning); }
.announcement-item.is-error { --announcement-accent: var(--app-error); }

.announcement-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.announcement-item__dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--announcement-accent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--announcement-accent) 55%, transparent);
}
.announcement-item__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--app-text);
  overflow-wrap: anywhere;
}
.announcement-item__content {
  margin-top: 8px;
  color: var(--app-text-2);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.announcement-item__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}
.announcement-item__time {
  font-size: 11px;
  color: var(--app-text-3);
  font-variant-numeric: tabular-nums;
}
</style>
