<template>
  <div class="app-panel">
    <div class="app-panel__head">
      <span class="app-panel__title">{{ t('cdnZoneSetting.globalTitle') }}</span>
      <span class="app-panel__extra hint-text">{{ t('cdnZone.globalHint') }}</span>
    </div>

    <n-alert v-if="unsupported" type="warning" :show-icon="false">
      <div>{{ t('cdnZoneSetting.globalEsaUnsupported') }}</div>
      <n-button size="tiny" style="margin-top: 8px" @click="emit('goRules')">
        {{ t('cdnZoneSetting.globalGoRules') }}
      </n-button>
    </n-alert>

    <n-spin v-else :show="loadBusy">
      <n-form label-placement="left" label-width="110">
        <n-divider class="section" title-placement="left">HTTPS / TLS</n-divider>
        <n-form-item :label="t('cdnZone.forceHttpsLabel')">
          <n-switch v-model:value="zone.forceSwitch" />
          <EsaCardSelect
            v-model="zone.forceCode"
            :options="[{ label: '302', value: 302 }, { label: '301', value: 301 }]"
            dense
            style="width: 120px; margin-left: 8px"
          />
        </n-form-item>
        <n-form-item label="HTTP/2"><n-switch v-model:value="zone.http2" /></n-form-item>
        <n-form-item label="OCSP Stapling"><n-switch v-model:value="zone.ocsp" /></n-form-item>
        <n-form-item label="HSTS">
          <n-space>
            <n-switch v-model:value="zone.hstsSwitch" />
            <span>{{ t('cdnZone.includeSub') }}</span><n-switch v-model:value="zone.hstsSub" size="small" />
            <span>Preload</span><n-switch v-model:value="zone.hstsPreload" size="small" />
            <span>MaxAge</span><n-input-number v-model:value="zone.hstsMaxage" :min="0" style="width: 110px" />
          </n-space>
        </n-form-item>
        <n-form-item :label="t('cdnZone.tlsVersionLabel')">
          <n-space>
            <n-checkbox v-model:checked="zone.tls12">TLS 1.2</n-checkbox>
            <n-checkbox v-model:checked="zone.tls13">TLS 1.3</n-checkbox>
          </n-space>
        </n-form-item>

        <n-divider class="section" title-placement="left">{{ t('cdnZone.networkDivider') }}</n-divider>
        <n-form-item label="HTTP/3（QUIC）"><n-switch v-model:value="zone.quic" /></n-form-item>
        <n-form-item :label="t('cdnZone.upstreamHttp2Label')"><n-switch v-model:value="zone.upstreamHttp2" /></n-form-item>
        <n-form-item label="gRPC"><n-switch v-model:value="zone.grpc" /></n-form-item>
        <n-form-item label="WebSocket">
          <n-space>
            <n-switch v-model:value="zone.websocketSwitch" />
            <span>{{ t('cdnZone.timeoutLabel') }}</span>
            <n-input-number v-model:value="zone.websocketTimeout" :min="1" style="width: 80px" />
          </n-space>
        </n-form-item>

        <n-divider class="section" title-placement="left">{{ t('cdnZone.cacheDivider') }}</n-divider>
        <n-form-item :label="t('cdnZone.cacheModeLabel')">
          <n-space>
            <n-radio-group v-model:value="zone.cacheMode">
              <n-radio value="follow">{{ t('cdnZone.followOrigin') }}</n-radio>
              <n-radio value="custom">{{ t('cdnZone.customTime') }}</n-radio>
              <n-radio value="nocache">{{ t('cdnZone.noCache') }}</n-radio>
            </n-radio-group>
            <n-input-number v-model:value="zone.cacheTime" :min="0" style="width: 120px" :placeholder="t('cdnZone.cacheTimePlaceholder')" />
          </n-space>
        </n-form-item>
        <n-form-item :label="t('cdnZone.cachePrefreshLabel')"><n-switch v-model:value="zone.cachePrefresh" /></n-form-item>
        <n-form-item :label="t('cdnZone.offlineCacheLabel')"><n-switch v-model:value="zone.offlineCache" /></n-form-item>

        <n-divider class="section" title-placement="left">{{ t('cdnZone.perfDivider') }}</n-divider>
        <n-form-item :label="t('cdnZone.smartRoutingLabel')"><n-switch v-model:value="zone.smartRouting" /></n-form-item>
        <n-form-item :label="t('cdnZone.compressionLabel')">
          <n-space>
            <n-switch v-model:value="zone.compression" />
            <n-checkbox v-model:checked="zone.compGzip">gzip</n-checkbox>
            <n-checkbox v-model:checked="zone.compBrotli">brotli</n-checkbox>
          </n-space>
        </n-form-item>

        <n-divider class="section" title-placement="left">{{ t('cdnZone.otherDivider') }}</n-divider>
        <n-form-item :label="t('cdnZone.ipv6Label')"><n-switch v-model:value="zone.ipv6" /></n-form-item>
        <n-form-item :label="t('cdnZone.clientIpHeaderLabel')">
          <n-space>
            <n-switch v-model:value="zone.clientIpHeader" />
            <n-input v-model:value="zone.clientIpHeaderName" :placeholder="t('cdnZone.headerNamePlaceholder')" style="width: 200px" />
          </n-space>
        </n-form-item>
        <n-form-item :label="t('cdnZone.clientIpCountryLabel')"><n-switch v-model:value="zone.clientIpCountry" /></n-form-item>
        <n-form-item :label="t('cdnZone.postmaxLabel')">
          <n-space>
            <n-switch v-model:value="zone.postmax" />
            <n-input-number v-model:value="zone.postmaxSize" :min="0" style="width: 160px" :placeholder="t('cdnZone.postmaxPlaceholder')" />
          </n-space>
        </n-form-item>
        <n-form-item :label="t('cdnZone.mainlandLabel')"><n-switch v-model:value="zone.accelerateMainland" /></n-form-item>

        <div class="global-setting__actions">
          <n-button type="primary" size="small" :loading="saveBusy" @click="save">{{ t('cdnZone.saveZone') }}</n-button>
        </div>
      </n-form>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  NAlert, NButton, NCheckbox, NDivider, NForm, NFormItem, NInput,
  NInputNumber, NRadio, NRadioGroup, NSpace, NSpin, NSwitch, useMessage,
} from 'naive-ui';
import EsaCardSelect from './EsaCardSelect.vue';
import { api } from '../../api';

const props = defineProps<{ aid: number; zoneId: string }>();
const emit = defineEmits<{ (e: 'goRules'): void }>();

const { t } = useI18n();
const message = useMessage();
const loadBusy = ref(false);
const saveBusy = ref(false);
const unsupported = ref(false);
const zoneSetting = ref<Record<string, any>>({});

const zone = reactive<any>({
  forceSwitch: false, forceCode: 302,
  http2: false, ocsp: false,
  hstsSwitch: false, hstsSub: false, hstsPreload: false, hstsMaxage: 0,
  tls12: true, tls13: true,
  quic: false, upstreamHttp2: false, grpc: false, websocketSwitch: false, websocketTimeout: 30,
  cacheMode: 'follow', cacheTime: 0, cachePrefresh: false, offlineCache: false,
  smartRouting: false, compression: false, compGzip: false, compBrotli: false,
  ipv6: false, clientIpHeader: false, clientIpHeaderName: '', clientIpCountry: false,
  postmax: true, postmaxSize: 838860800, accelerateMainland: false,
});

function ov(key: string, sub: string, def: any): any {
  const o = zoneSetting.value?.[key];
  return o && o[sub] !== undefined && o[sub] !== '' && o[sub] !== null ? o[sub] : def;
}

function loadZone() {
  zone.forceSwitch = ov('ForceRedirectHTTPS', 'Switch', 'off') === 'on';
  zone.forceCode = Number(ov('ForceRedirectHTTPS', 'RedirectStatusCode', 302));
  zone.http2 = ov('HTTP2', 'Switch', 'off') === 'on';
  zone.ocsp = ov('OCSPStapling', 'Switch', 'off') === 'on';
  zone.hstsSwitch = ov('HSTS', 'Switch', 'off') === 'on';
  zone.hstsSub = ov('HSTS', 'IncludeSubDomains', 'off') === 'on';
  zone.hstsPreload = ov('HSTS', 'Preload', 'off') === 'on';
  zone.hstsMaxage = Number(ov('HSTS', 'Timeout', 0) || 0);
  const tlsv = zoneSetting.value?.TLSConfig?.Version || [];
  zone.tls12 = tlsv.includes('TLSv1.2');
  zone.tls13 = tlsv.includes('TLSv1.3');
  zone.quic = ov('QUIC', 'Switch', 'off') === 'on';
  zone.upstreamHttp2 = ov('UpstreamHTTP2', 'Switch', 'off') === 'on';
  zone.grpc = ov('Grpc', 'Switch', 'off') === 'on';
  zone.websocketSwitch = ov('WebSocket', 'Switch', 'off') === 'on';
  zone.websocketTimeout = Number(ov('WebSocket', 'Timeout', 30) || 30);
  const cache = zoneSetting.value?.Cache;
  if (cache?.NoCache?.Switch === 'on') zone.cacheMode = 'nocache';
  else if (cache?.CustomTime?.Switch === 'on') zone.cacheMode = 'custom';
  else zone.cacheMode = 'follow';
  zone.cacheTime = Number(cache?.CustomTime?.CacheTime || 0);
  zone.cachePrefresh = ov('CachePrefresh', 'Switch', 'off') === 'on';
  zone.offlineCache = ov('OfflineCache', 'Switch', 'off') === 'on';
  zone.smartRouting = ov('SmartRouting', 'Switch', 'off') === 'on';
  zone.compression = ov('Compression', 'Switch', 'off') === 'on';
  const algos = zoneSetting.value?.Compression?.Algorithms || [];
  zone.compGzip = algos.includes('gzip');
  zone.compBrotli = algos.includes('brotli');
  zone.ipv6 = ov('IPv6', 'Switch', 'off') === 'on';
  zone.clientIpHeader = ov('ClientIPHeader', 'Switch', 'off') === 'on';
  zone.clientIpHeaderName = ov('ClientIPHeader', 'HeaderName', '') || '';
  zone.clientIpCountry = ov('ClientIPCountry', 'Switch', 'off') === 'on';
  zone.postmax = ov('PostMaxSize', 'Switch', 'on') === 'on';
  zone.postmaxSize = Number(ov('PostMaxSize', 'MaxSize', 838860800) || 838860800);
  zone.accelerateMainland = ov('AccelerateMainland', 'Switch', 'off') === 'on';
}

async function load() {
  if (!props.aid || !props.zoneId) return;
  loadBusy.value = true;
  unsupported.value = false;
  const res = await api<any>('GET', '/cdn/zones/setting', { aid: props.aid, zone_id: props.zoneId });
  loadBusy.value = false;
  if (res.code === 0) {
    zoneSetting.value = res.data.zoneSetting || {};
    loadZone();
  } else {
    // 该站点类型未实现站点级全局配置（如当前 ESA），改为显式提示并引导到规则引擎
    unsupported.value = true;
  }
}

async function save() {
  const tlsVersions: string[] = [];
  if (zone.tls12) tlsVersions.push('TLSv1.2');
  if (zone.tls13) tlsVersions.push('TLSv1.3');
  const algos: string[] = [];
  if (zone.compGzip) algos.push('gzip');
  if (zone.compBrotli) algos.push('brotli');
  const cfg: Record<string, any> = {
    ForceRedirectHTTPS: { Switch: zone.forceSwitch ? 'on' : 'off', RedirectStatusCode: zone.forceCode },
    HTTP2: { Switch: zone.http2 ? 'on' : 'off' },
    OCSPStapling: { Switch: zone.ocsp ? 'on' : 'off' },
    HSTS: {
      Switch: zone.hstsSwitch ? 'on' : 'off',
      IncludeSubDomains: zone.hstsSub ? 'on' : 'off',
      Preload: zone.hstsPreload ? 'on' : 'off',
      Timeout: Number(zone.hstsMaxage || 0),
    },
    TLSConfig: { Version: tlsVersions, CipherSuite: zoneSetting.value?.TLSConfig?.CipherSuite || 'general-v2023' },
    QUIC: { Switch: zone.quic ? 'on' : 'off' },
    UpstreamHTTP2: { Switch: zone.upstreamHttp2 ? 'on' : 'off' },
    Grpc: { Switch: zone.grpc ? 'on' : 'off' },
    WebSocket: { Switch: zone.websocketSwitch ? 'on' : 'off', Timeout: Number(zone.websocketTimeout || 30) },
    Cache: {
      FollowOrigin: { Switch: zone.cacheMode === 'follow' ? 'on' : 'off', DefaultCache: 'on', DefaultCacheStrategy: 'on', DefaultCacheTime: 0 },
      CustomTime: { Switch: zone.cacheMode === 'custom' ? 'on' : 'off', CacheTime: Number(zone.cacheTime || 0) },
      NoCache: { Switch: zone.cacheMode === 'nocache' ? 'on' : 'off' },
    },
    CachePrefresh: { Switch: zone.cachePrefresh ? 'on' : 'off', CacheTimePercent: Number(zoneSetting.value?.CachePrefresh?.CacheTimePercent || 90) },
    SmartRouting: { Switch: zone.smartRouting ? 'on' : 'off' },
    Compression: { Switch: zone.compression ? 'on' : 'off', Algorithms: algos },
    OfflineCache: { Switch: zone.offlineCache ? 'on' : 'off' },
    ClientIPHeader: { Switch: zone.clientIpHeader ? 'on' : 'off', HeaderName: zone.clientIpHeaderName || '' },
    ClientIPCountry: { Switch: zone.clientIpCountry ? 'on' : 'off', HeaderName: zoneSetting.value?.ClientIPCountry?.HeaderName || '' },
    PostMaxSize: { Switch: zone.postmax ? 'on' : 'off', MaxSize: Number(zone.postmaxSize || 0) },
    IPv6: { Switch: zone.ipv6 ? 'on' : 'off' },
    AccelerateMainland: { Switch: zone.accelerateMainland ? 'on' : 'off' },
  };
  saveBusy.value = true;
  const res = await api<any>('POST', '/cdn/zones/setting', { aid: props.aid, zone_id: props.zoneId, setting: cfg });
  saveBusy.value = false;
  if (res.code === 0) {
    message.success(res.msg || t('cdnZoneSetting.saved'));
    load();
  } else message.error(res.msg);
}

watch(() => [props.aid, props.zoneId], load, { immediate: true });
</script>

<style scoped>
.global-setting__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
  margin-top: 4px;
  border-top: 1px solid var(--app-divider);
}
</style>
