<template>
  <ProviderGroupView
    :group="group"
    :labels="labels"
    :series="series"
    :breakdowns="breakdowns"
    :charts="charts"
    :top-dims="topDims"
    :top-dim="topDim"
    @update:top-dim="$emit('update:topDim', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ProviderGroupView, { type SeriesInput, type BreakdownInput } from '../../components/statistics/ProviderGroupView.vue';
import { GROUP_CHARTS } from '../../lib/statistics/catalog';

const props = defineProps<{
  group: string;
  labels: string[];
  series: SeriesInput[];
  breakdowns: BreakdownInput[];
  topDims: string[];
  topDim: string;
}>();

defineEmits<{ (e: 'update:topDim', value: string): void }>();

const charts = computed(() => GROUP_CHARTS.aliyun_esa?.[props.group] || []);
</script>
