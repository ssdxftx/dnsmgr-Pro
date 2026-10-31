<script setup lang="ts">
import { useData } from 'valaxy'
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { page } = useData()

const DOCS_UPDATED_AT = Date.UTC(2026, 9, 30, 0, 0, 0)

const timestamp = computed(() => {
  const raw = Number(page.value?.lastUpdated || 0)
  return Number.isFinite(raw) && raw > 0 ? raw : DOCS_UPDATED_AT
})

const date = computed(() => new Date(timestamp.value))
const isoDatetime = computed(() => date.value.toISOString())
const datetime = ref(timestamp.value === DOCS_UPDATED_AT ? '2026/10/30' : '')

onMounted(() => {
  watchEffect(() => {
    datetime.value = date.value.toLocaleString(window.navigator.language)
  })
})
</script>

<template>
  <p class="press-lastUpdated text-right">
    {{ t('tooltip.last_updated') }}:
    <time :datetime="isoDatetime">{{ datetime }}</time>
  </p>
</template>

<style scoped>
.press-lastUpdated {
  line-height: 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--va-c-text-light);
}

@media (width >= 640px) {
  .press-lastUpdated {
    line-height: 32px;
    font-size: 14px;
  }
}
</style>
