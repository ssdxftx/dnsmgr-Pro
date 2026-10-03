<template>
  <div class="app-stack">
    <PageHeader :title="(isEdit ? t('common.edit') : t('common.add')) + ' ' + t('dm.policyTitle')" :subtitle="t('dm.formSubtitle')" back="/dm-tasks" />
    <n-card :bordered="false">
      <n-form label-placement="left" label-width="110" style="max-width: 720px">
        <n-form-item :label="t('dm.domainSelect')" required>
          <n-space :size="4" style="width: 100%">
            <n-input v-model:value="form.rr" :placeholder="t('dm.hostRecord')" style="width: 200px" />
            <span>.</span>
            <n-select v-model:value="form.did" :options="domainOptions" :placeholder="t('dm.mainDomain')" filterable style="flex: 1" @update:value="onDomainChange" />
          </n-space>
        </n-form-item>

        <n-form-item :label="t('dm.recordSelect')" required>
          <n-space style="width: 100%">
            <n-select v-model:value="form.recordid" :options="recordOptions" :placeholder="t('dm.recordSelect')" filterable style="flex: 1" @update:value="onRecordChange" />
            <n-button @click="getRecordList" :loading="loadingRecords">{{ t('dm.fetch') }}</n-button>
          </n-space>
        </n-form-item>

        <n-form-item :label="t('dm.switchSet')" required>
          <n-radio-group v-model:value="form.type">
            <n-radio-button v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type === 2" :label="t('dm.backupRecord')" required>
          <n-input v-model:value="form.backup_value" :placeholder="t('dm.ipOrCname')" />
        </n-form-item>

        <n-form-item v-show="form.type === 2 && dnstype === 'cloudflare'" :label="t('dm.cfProxy')">
          <n-checkbox v-model:checked="form.cdn">{{ t('dm.cfProxyHint') }}</n-checkbox>
        </n-form-item>

        <n-form-item v-show="form.type <= 2" :label="t('dm.checkProto')" required>
          <n-radio-group v-model:value="form.checktype">
            <n-radio-button v-for="o in checktypeOptions" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype < 2" :label="t('dm.checkIp')">
          <n-input v-model:value="form.checkurl" :placeholder="t('dm.ipDefault')" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 1" :label="t('dm.tcpPort')" required>
          <n-input-number v-model:value="form.tcpport" :min="1" :max="65535" style="width: 220px" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 2" :label="t('dm.checkUrl')" required>
          <n-input v-model:value="form.checkurl" :placeholder="t('dm.urlPlaceholder')" />
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype === 2" :label="t('dm.useProxy')">
          <n-radio-group v-model:value="form.proxy">
            <n-radio :value="0">{{ t('common.no') }}</n-radio>
            <n-radio :value="1">{{ t('common.yes') }}</n-radio>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-show="form.type <= 2 && form.checktype > 0" :label="t('dm.timeout')" required>
          <n-input-number v-model:value="form.timeout" :min="1" style="width: 220px">
            <template #suffix>{{ t('dm.second') }}</template>
          </n-input-number>
        </n-form-item>

        <n-form-item v-show="form.type === 3" :label="t('dm.condCount')" required>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-input-number v-model:value="form.cycle" :min="0" style="width: 220px" />
            </template>
            {{ t('dm.condHint') }}
          </n-tooltip>
        </n-form-item>

        <n-form-item :label="t('dm.checkInterval')" required>
          <n-input-number v-model:value="form.frequency" :min="1" style="width: 220px">
            <template #suffix>{{ t('dm.second') }}</template>
          </n-input-number>
        </n-form-item>

        <n-form-item v-show="form.type <= 2" :label="t('dm.confirmCount')" required>
          <n-input-number v-model:value="form.cycle" :min="1" style="width: 220px" />
        </n-form-item>

        <n-form-item :label="t('common.remark')">
          <n-input v-model:value="form.remark" :placeholder="t('dm.optional')" />
        </n-form-item>

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
const recordOptions = ref<any[]>([]);
const dnstype = ref<string | null>(null);
const loadingRecords = ref(false);
const saving = ref(false);
const pingDisabled = ref(false);

const form = reactive<any>({
  rr: '',
  did: null,
  recordid: null,
  recordinfo: '',
  main_value: '',
  type: 1,
  backup_value: '',
  checktype: 1,
  tcpport: 80,
  checkurl: '',
  frequency: 5,
  timeout: 2,
  cycle: 3,
  proxy: 0,
  cdn: false,
  remark: '',
});

const typeOptions = computed(() => [
  { value: 0, label: t('dm.noAction') },
  { value: 1, label: t('dm.pauseRecord') },
  { value: 2, label: t('dm.switchBackupRecord') },
  { value: 3, label: t('dm.condEnableFull') },
]);
const checktypeOptions = computed(() => [
  { value: 0, label: 'PING', disabled: pingDisabled.value },
  { value: 1, label: 'TCP', disabled: false },
  { value: 2, label: 'HTTP(S)', disabled: false },
]);

async function loadDomains() {
  const res = await api<any>('GET', '/dmonitor/domains');
  if (res.code === 0) {
    domainOptions.value = res.data.map((d: any) => ({ label: d.name, value: d.id, type: d.type }));
  }
}

function onDomainChange() {
  const d = domainOptions.value.find((x) => x.value === form.did);
  dnstype.value = d ? d.type : null;
}

async function getRecordList() {
  if (!form.did) return message.warning(t('dm.selectDomainFirst'));
  if (!form.rr) return message.warning(t('dm.hostRequired'));
  loadingRecords.value = true;
  const res = await api<any>('GET', `/domains/${form.did}/records`, { subdomain: form.rr, pagesize: 100 });
  loadingRecords.value = false;
  if (res.code === 0) {
    const list = res.data.list || [];
    recordOptions.value = list.map((r: any) => ({ label: `${r.Value} (${r.Type})`, value: r.RecordId, record: r }));
    message.success(t('dm.gotRecords', { count: list.length }));
    if (form.recordid) {
      const found = list.find((r: any) => r.RecordId === form.recordid);
      if (found) fillRecord(found);
    }
  } else {
    message.error(res.msg);
  }
}

function fillRecord(record: any) {
  form.recordinfo = JSON.stringify({ Line: record.Line, TTL: record.TTL });
  form.main_value = typeof record.Value === 'object' ? (Array.isArray(record.Value) ? record.Value[0] : record.Value) : record.Value;
}

function onRecordChange() {
  const opt = recordOptions.value.find((x: any) => x.value === form.recordid);
  if (opt && opt.record) fillRecord(opt.record);
}

async function loadTask() {
  const res = await api<any>('GET', `/dmonitor/tasks/${editId.value}`);
  if (res.code === 0) {
    const t = res.data;
    form.rr = t.rr;
    form.did = t.did;
    form.recordid = t.recordid;
    form.recordinfo = t.recordinfo || '';
    form.main_value = t.main_value;
    form.type = t.type;
    form.backup_value = t.backup_value || '';
    form.checktype = t.checktype;
    form.tcpport = t.tcpport ?? 80;
    form.checkurl = t.checkurl || '';
    form.frequency = t.frequency;
    form.timeout = t.timeout;
    form.cycle = t.cycle;
    form.proxy = t.proxy;
    form.cdn = t.cdn === 1;
    form.remark = t.remark || '';
    onDomainChange();
    // 填充已选解析记录
    let info: any = {};
    try {
      info = JSON.parse(t.recordinfo || '{}');
    } catch {}
    recordOptions.value = [{ label: t.main_value, value: t.recordid, record: { RecordId: t.recordid, Value: t.main_value, Line: info.Line, TTL: info.TTL } }];
  } else {
    message.error(res.msg);
  }
}

async function submit() {
  if (!form.did || !form.rr || !form.recordid || !form.main_value || !form.frequency || !form.cycle) {
    return message.warning(t('dm.requiredEmpty'));
  }
  if (form.checktype > 0 && form.timeout > form.frequency) {
    return message.warning(t('dm.timeoutHint'));
  }
  if (form.type === 2 && form.backup_value === form.main_value) {
    return message.warning(t('dm.sameValue'));
  }
  saving.value = true;
  const body = {
    did: form.did,
    rr: form.rr,
    recordid: form.recordid,
    type: form.type,
    main_value: form.main_value,
    backup_value: form.backup_value,
    checktype: form.checktype,
    checkurl: form.checkurl,
    tcpport: form.tcpport,
    frequency: form.frequency,
    cycle: form.cycle,
    timeout: form.timeout,
    proxy: form.proxy,
    cdn: form.cdn,
    remark: form.remark,
    recordinfo: form.recordinfo,
  };
  const res = isEdit.value ? await api('PUT', `/dmonitor/tasks/${editId.value}`, body) : await api('POST', '/dmonitor/tasks', body);
  saving.value = false;
  if (res.code === 0) {
    message.success(res.msg);
    router.push('/dm-tasks');
  } else {
    message.error(res.msg);
  }
}

onMounted(async () => {
  await loadDomains();
  if (isEdit.value) await loadTask();
});
</script>