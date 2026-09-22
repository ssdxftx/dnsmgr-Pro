<template>
  <div>
    <n-grid cols="1 s:2" responsive="screen" :x-gap="16" :y-gap="16">
      <n-grid-item>
        <n-card :bordered="false" title="功能简介">
          <p class="desc">由于CloudFlare官方IP是泛播路由，同一个IP在不同地区不同运营商所链接的机房不同，速度或延迟也有区别。</p>
          <p class="desc">本功能可以获取CloudFlare最新的优选IP地址（分为电信/联通/移动线路），并自动更新到域名解析记录。</p>
        </n-card>
        <n-card :bordered="false" title="使用说明" style="margin-top: 16px">
          <ul class="tips">
            <li>不支持对CloudFlare里的域名添加优选，必须使用其他DNS服务商。需开通Cloudflare for SaaS，且域名使用CNAME方式解析到CloudFlare。</li>
            <li>数据接口：wetest.vip 支持CloudFlare、CloudFront、EdgeOne；HostMonit 只支持CloudFlare；xingpingcn.top 只支持CloudFlare（免费、无需密钥）。</li>
            <li>接口密钥：请在系统设置中填写，不再内置默认密钥。</li>
            <li>代理地址：如 https://ghfast.top/https://raw.githubusercontent.com/，留空则直接访问 GitHub。</li>
          </ul>
        </n-card>
      </n-grid-item>

      <n-grid-item>
        <n-card :bordered="false" title="数据接口设置">
          <n-form :label-placement="labelPlacement" label-width="90">
            <n-form-item label="数据接口">
              <n-select v-model:value="form.optimize_ip_api" :options="apiOptions" @update:value="onApiChange" />
            </n-form-item>
            <n-form-item v-if="form.optimize_ip_api !== '2'" label="接口密钥">
              <n-input v-model:value="form.optimize_ip_key" placeholder="接口密钥" />
            </n-form-item>
            <n-form-item v-if="form.optimize_ip_api === '2'" label="代理地址">
              <n-input v-model:value="form.optimize_ip_proxy" placeholder="留空则直接访问GitHub" />
            </n-form-item>
            <n-form-item :show-feedback="false">
              <n-space class="btn-row">
                <n-button type="primary" :loading="saving" @click="save">保存</n-button>
                <n-button v-if="form.optimize_ip_api !== '2'" @click="queryApi">查询积分</n-button>
              </n-space>
            </n-form-item>
          </n-form>
        </n-card>

        <n-card :bordered="false" title="自动更新设置" style="margin-top: 16px">
          <n-form :label-placement="labelPlacement" label-width="110">
            <n-form-item label="自动更新间隔">
              <n-input-number v-model:value="form.optimize_ip_min" :min="10" class="interval-input">
                <template #suffix>分钟</template>
              </n-input-number>
            </n-form-item>
            <n-form-item :show-feedback="false">
              <n-space class="btn-row">
                <n-button type="primary" :loading="saving" @click="save">保存</n-button>
              </n-space>
            </n-form-item>
          </n-form>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { api } from '../api';

const message = useMessage();
const saving = ref(false);

const isMobile = ref(false);
const labelPlacement = computed(() => (isMobile.value ? 'top' : 'left'));

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}
onMounted(() => {
  checkMobile();
  window.addEventListener('resize', checkMobile);
});
onBeforeUnmount(() => window.removeEventListener('resize', checkMobile));

const apiOptions = [
  { label: 'wetest.vip', value: '0' },
  { label: 'HostMonit', value: '1' },
  { label: 'xingpingcn.top', value: '2' },
];

const form = reactive({
  optimize_ip_api: '0',
  optimize_ip_key: '',
  optimize_ip_proxy: '',
  optimize_ip_min: '30',
});

function onApiChange() {
  // 切换接口时重置默认值
}

async function load() {
  const res = await api<any>('GET', '/optimize/settings');
  if (res.code === 0) {
    form.optimize_ip_api = res.data.optimize_ip_api;
    form.optimize_ip_key = res.data.optimize_ip_key;
    form.optimize_ip_proxy = res.data.optimize_ip_proxy;
    form.optimize_ip_min = res.data.optimize_ip_min;
  }
}

async function save() {
  saving.value = true;
  const res = await api('POST', '/optimize/settings', { ...form });
  saving.value = false;
  if (res.code === 0) message.success('设置保存成功');
  else message.error(res.msg);
}

async function queryApi() {
  message.loading('查询中...');
  const res = await api('POST', '/optimize/queryapi', { optimize_ip_api: Number(form.optimize_ip_api), optimize_ip_key: form.optimize_ip_key });
  if (res.code === 0) message.success(res.msg);
  else message.error(res.msg);
}

onMounted(load);
</script>

<style scoped>
.desc {
  margin: 0 0 8px;
  line-height: 1.7;
  color: #4b5563;
}
.desc:last-child {
  margin-bottom: 0;
}
.tips {
  margin: 0;
  padding-left: 20px;
  line-height: 1.7;
  color: #4b5563;
}
.tips li {
  margin-bottom: 6px;
}
.tips li:last-child {
  margin-bottom: 0;
}
.interval-input {
  width: 220px;
}

@media (max-width: 768px) {
  .desc,
  .tips {
    font-size: 13px;
  }
  .tips {
    padding-left: 18px;
    word-break: break-all;
  }
  .interval-input {
    width: 100%;
  }
  .btn-row {
    width: 100%;
  }
  .btn-row :deep(.n-button) {
    flex: 1;
  }
}
</style>