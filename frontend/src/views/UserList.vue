<template>
  <div class="app-stack">
    <PageHeader title="用户管理" subtitle="管理平台用户、权限与 API 接口">
      <template #actions>
        <n-button type="primary" @click="openAdd">
          <template #icon><n-icon :component="AddOutline" /></template>
          添加用户
        </n-button>
      </template>
    </PageHeader>
    <n-card :bordered="false">
      <n-space style="margin-bottom: 16px">
        <n-input v-model:value="kw" placeholder="UID或用户名" style="width: 220px" @keyup.enter="search" />
        <n-button type="primary" @click="search"><template #icon><n-icon :component="SearchOutline" /></template>搜索</n-button>
        <n-button @click="clearSearch"><template #icon><n-icon :component="RefreshOutline" /></template>刷新</n-button>
      </n-space>

      <ResponsiveDataTable
        :columns="columns"
        :data="users"
        :loading="loading"
        :pagination="pagination"
        :row-key="(row: any) => row.id"
        empty-text="暂无用户"
      />
    </n-card>

    <n-modal v-model:show="showEdit" preset="card" :title="editingId ? '修改用户' : '添加用户'" :style="modalStyle" :mask-closable="false">
      <n-form :label-placement="labelPlacement" :label-width="isMobile ? 'auto' : 110">
        <n-form-item label="用户名" required>
          <n-input v-model:value="form.username" />
        </n-form-item>
        <n-form-item v-if="!editingId" label="密码" required>
          <n-input-group>
            <n-input v-model:value="form.password" type="password" show-password-on="click" />
            <n-button @click="genPassword">随机生成</n-button>
          </n-input-group>
        </n-form-item>
        <n-form-item v-if="editingId" label="重置密码">
          <n-input v-model:value="form.repwd" type="password" show-password-on="click" placeholder="不重置密码请留空" />
        </n-form-item>
        <n-form-item label="API接口">
          <n-select v-model:value="form.is_api" :options="apiOptions" style="width: 160px" />
        </n-form-item>
        <n-form-item v-if="form.is_api === 1" label="API密钥" required>
          <n-input-group>
            <n-input v-model:value="form.apikey" readonly />
            <n-button @click="genApikey">生成密钥</n-button>
          </n-input-group>
        </n-form-item>
        <n-form-item label="用户等级">
          <n-select v-model:value="form.level" :options="levelOptions" style="width: 160px" />
        </n-form-item>
        <n-form-item v-if="form.level === 1" label="检测整域名">
          <n-switch v-model:value="form.check_whole" />
          <n-text depth="3" style="font-size: 12px; margin-left: 8px">开启后该用户可对授权域名设置检测整个域名的全部子域名</n-text>
        </n-form-item>
        <n-form-item v-if="form.level === 1" label="子域名分配">
          <div class="perm-list">
            <div v-for="(p, idx) in form.permission" :key="idx" class="perm-item">
              <div class="perm-row">
                <n-select v-model:value="p.domain" :options="domainOptions" placeholder="选择域名" filterable class="perm-domain" />
                <div class="perm-actions">
                  <n-select v-model:value="p.readonly" :options="modeOptions" class="perm-mode" />
                  <n-button size="small" type="error" quaternary @click="removePerm(idx)">删除</n-button>
                </div>
              </div>
              <n-input v-model:value="p.sub" placeholder="子域名前缀，如 user1 或 a.user1（留空=整域名）" />
              <n-date-picker v-model:value="p.expiretime" type="datetime" value-format="yyyy-MM-dd HH:mm:ss" clearable placeholder="有效期至（留空=永久）" style="width: 100%" />
            </div>
            <n-button size="small" dashed @click="addPerm">添加子域名授权</n-button>
          </div>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">关闭</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { NButton, NSpace, NTag, useMessage, useDialog } from 'naive-ui';
import { AddOutline, SearchOutline, RefreshOutline } from '@vicons/ionicons5';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import ResponsiveDataTable from '../components/ResponsiveDataTable.vue';

const message = useMessage();
const dialog = useDialog();
const loading = ref(false);
const users = ref<any[]>([]);
const page = ref(1);
const pageSize = ref(10);
const kw = ref('');

const showEdit = ref(false);
const editingId = ref<number | null>(null);
const saving = ref(false);
const form = reactive<any>({ username: '', password: '', repwd: '', is_api: 0, apikey: '', level: 1, check_whole: false, permission: [] });
const domainOptions = ref<any[]>([]);

const isMobile = ref(false);
function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));

// 手机端标签置顶并把弹窗限制在视口内，避免子域名分配的域名选择框被挤压
const labelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));
const modalStyle = computed(() => (isMobile.value ? { width: 'calc(100vw - 24px)', maxWidth: '520px' } : { maxWidth: '520px' }));

const apiOptions = [
  { label: '关闭', value: 0 },
  { label: '开启', value: 1 },
];
const levelOptions = [
  { label: '普通用户', value: 1 },
  { label: '管理员', value: 2 },
];
const modeOptions = [
  { label: '自由解析', value: 0 },
  { label: '仅查看', value: 1 },
];

const pagination = reactive({
  page: 1,
  pageSize: 10,
  itemCount: 0,
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  onChange: (p: number) => {
    page.value = p;
    loadUsers();
  },
  onUpdatePageSize: (s: number) => {
    pageSize.value = s;
    page.value = 1;
    loadUsers();
  },
});

const columns: any[] = [
  { title: 'UID', key: 'id', width: 70, sorter: true },
  { title: '用户名', key: 'username', minWidth: 140 },
  {
    title: '用户等级',
    key: 'level',
    width: 100,
    render(row: any) {
      if (row.level === 2) return h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '管理员' });
      if (row.level === 1) return h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => '普通用户' });
      return row.level;
    },
  },
  {
    title: 'API接口',
    key: 'is_api',
    width: 90,
    render(row: any) {
      return h(NTag, { size: 'small', type: row.is_api ? 'success' : 'default', bordered: false }, { default: () => (row.is_api ? '开启' : '关闭') });
    },
  },
  { title: '添加时间', key: 'regtime', width: 170 },
  { title: '上次登录', key: 'lasttime', width: 170 },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render(row: any) {
      return h(
        NButton,
        { size: 'tiny', type: row.status ? 'success' : 'error', onClick: () => toggleStatus(row) },
        { default: () => (row.status ? '正常' : '封禁') }
      );
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render(row: any) {
      const btns: any[] = [];
      btns.push(h(NButton, { size: 'tiny', type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }));
      btns.push(h(NButton, { size: 'tiny', type: 'error', onClick: () => del(row) }, { default: () => '删除' }));
      return h(NSpace, null, { default: () => btns });
    },
  },
];

async function loadUsers() {
  loading.value = true;
  const res = await api<any>('GET', '/users', { offset: (page.value - 1) * pageSize.value, limit: pageSize.value, kw: kw.value || undefined });
  if (res.code === 0) {
    users.value = res.data.list;
    pagination.itemCount = res.data.total;
    pagination.page = page.value;
    pagination.pageSize = pageSize.value;
  } else message.error(res.msg);
  loading.value = false;
}

async function loadDomains() {
  const res = await api<any>('GET', '/user/domains');
  if (res.code === 0) domainOptions.value = res.data.map((d: string) => ({ label: d, value: d }));
}

function search() {
  page.value = 1;
  loadUsers();
}
function clearSearch() {
  kw.value = '';
  page.value = 1;
  loadUsers();
}

function genPassword() {
  form.password = randomStr(12);
}
function addPerm() {
  form.permission.push({ domain: '', sub: '', readonly: 0, expiretime: null });
}
function removePerm(idx: number) {
  form.permission.splice(idx, 1);
}
function genApikey() {
  form.apikey = randomStr(16);
}
function randomStr(len: number): string {
  const str = 'abcdefhjmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWYXZ';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i++) s += str.charAt(buf[i] % str.length);
  return s;
}

function openAdd() {
  editingId.value = null;
  form.username = '';
  form.password = '';
  form.repwd = '';
  form.is_api = 0;
  form.apikey = genApikey();
  form.level = 1;
  form.check_whole = false;
  form.permission = [];
  showEdit.value = true;
}

async function openEdit(row: any) {
  const res = await api<any>('GET', `/users/${row.id}`);
  if (res.code === 0) {
    editingId.value = row.id;
    form.username = res.data.username;
    form.repwd = '';
    form.is_api = res.data.is_api;
    form.apikey = res.data.apikey || '';
    form.level = res.data.level;
    form.check_whole = res.data.check_whole == 1;
    form.permission = (res.data.permission || []).map((p: any) =>
      typeof p === 'string' ? { domain: p, sub: '', readonly: 0, expiretime: null } : { domain: p.domain, sub: p.sub || '', readonly: Number(p.readonly || 0), expiretime: p.expiretime || null },
    );
    showEdit.value = true;
  } else message.error(res.msg);
}

async function save() {
  if (!form.username) return message.warning('用户名不能为空');
  if (form.is_api === 1 && !form.apikey) return message.warning('API密钥不能为空');
  saving.value = true;
  const body: any = { username: form.username, is_api: form.is_api, apikey: form.apikey, level: form.level };
  if (form.level === 1) {
    body.permission = form.permission;
    body.check_whole = form.check_whole ? 1 : 0;
  }
  if (editingId.value) {
    body.repwd = form.repwd;
  } else {
    body.password = form.password;
  }
  const res = editingId.value ? await api('PUT', `/users/${editingId.value}`, body) : await api('POST', '/users', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    showEdit.value = false;
    loadUsers();
  } else message.error(res.msg);
}

function toggleStatus(row: any) {
  api('POST', `/users/${row.id}/status`, { status: row.status ? 0 : 1 }).then((res) => {
    if (res.code === 0) loadUsers();
    else message.error(res.msg);
  });
}

function del(row: any) {
  dialog.warning({
    title: '删除用户',
    content: '确定要删除此用户吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const res = await api('DELETE', `/users/${row.id}`);
      if (res.code === 0) {
        message.success('删除成功');
        loadUsers();
      } else message.error(res.msg);
    },
  });
}

onMounted(() => {
  loadUsers();
  loadDomains();
});
</script>

<style scoped>
.perm-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.perm-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
}
.perm-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.perm-domain {
  flex: 1;
  min-width: 0;
}
.perm-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.perm-mode {
  width: 110px;
}

@media (max-width: 768px) {
  .perm-row {
    flex-direction: column;
    align-items: stretch;
  }
  .perm-actions {
    justify-content: space-between;
  }
  .perm-mode {
    flex: 1;
    width: auto;
  }
  .perm-actions :deep(.n-button) {
    flex: none;
  }
}
</style>