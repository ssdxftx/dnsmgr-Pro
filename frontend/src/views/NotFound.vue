<template>
  <div class="app-stack">
    <PageHeader :title="t('route.notFound')" back="/dashboard" />
    <n-card :bordered="false">
      <EmptyState
        :icon="CompassOutline"
        :title="t('route.notFound')"
        :description="t('notFound.desc', { path: route.fullPath })"
      >
        <template #actions>
          <n-space>
            <n-button @click="router.back()">{{ t('notFound.back') }}</n-button>
            <n-button type="primary" @click="router.push('/domains')">{{ t('notFound.home') }}</n-button>
          </n-space>
        </template>
      </EmptyState>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NCard, NSpace } from 'naive-ui';
import { CompassOutline } from '@vicons/ionicons5';
import PageHeader from '../components/PageHeader.vue';
import EmptyState from '../components/EmptyState.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
</script>
