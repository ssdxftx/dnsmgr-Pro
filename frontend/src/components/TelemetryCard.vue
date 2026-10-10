<template>
  <div class="tele-card" :class="`tele-card--${tone}`">
    <div class="tele-card__top">
      <span class="tele-card__icon">
        <n-icon size="20" :component="icon" />
      </span>
      <span v-if="delta" class="tele-card__delta" :class="deltaDir">
        {{ deltaDir === 'down' ? '▼' : '▲' }} {{ delta }}
      </span>
    </div>
    <div class="tele-card__label">{{ label }}</div>
    <div class="tele-card__value font-mono">
      {{ display }}<span v-if="suffix" class="tele-card__suffix">{{ suffix }}</span>
    </div>
    <svg v-if="points" class="tele-card__spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="spark-area" :points="`${points} 120,36 0,36`" />
      <polyline ref="lineRef" class="spark-line" :points="points" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue';
import { NIcon } from 'naive-ui';

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    suffix?: string;
    delta?: string;
    deltaDir?: 'up' | 'down';
    tone?: 'primary' | 'success' | 'warning' | 'error' | 'info';
    icon?: Component;
    spark?: number[];
  }>(),
  { suffix: '', delta: '', deltaDir: 'up', tone: 'primary', icon: undefined, spark: () => [] },
);

const reduce =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---- 计数动画（值异步到位时从当前值过渡到目标值） ---- */
const display = ref(0);
let raf = 0;
function animate(to: number) {
  cancelAnimationFrame(raf);
  if (reduce) { display.value = to; return; }
  const from = display.value;
  const start = performance.now();
  const dur = 1000;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    display.value = Math.round(from + (to - from) * eased);
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
watch(() => props.value, (v) => animate(Number(v) || 0));

/* ---- 曲线描边 ---- */
const lineRef = ref<SVGPolylineElement>();
const points = computed(() => {
  if (!props.spark || props.spark.length < 2) return '';
  const max = Math.max(...props.spark);
  const min = Math.min(...props.spark);
  const range = max - min || 1;
  const n = props.spark.length;
  return props.spark
    .map((v, i) => {
      const x = (i / (n - 1)) * 116 + 2;
      const y = 32 - ((v - min) / range) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

onMounted(() => {
  const el = lineRef.value;
  if (!el || reduce) return;
  const len = el.getTotalLength();
  el.style.strokeDasharray = String(len);
  el.style.strokeDashoffset = String(len);
  el.style.transition = 'stroke-dashoffset 1.3s var(--app-ease)';
  requestAnimationFrame(() => { el.style.strokeDashoffset = '0'; });
});
</script>

<style scoped>
.tele-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  background: var(--app-glass);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--app-shadow-sm);
  transition: transform 0.25s var(--app-ease), border-color 0.25s var(--app-ease), box-shadow 0.25s var(--app-ease);
}
.tele-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--app-primary) 60%, transparent), transparent);
  opacity: 0;
  transition: opacity 0.25s var(--app-ease);
}
.tele-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--app-primary) 40%, var(--app-border));
  box-shadow: var(--app-shadow);
}
.tele-card:hover::before {
  opacity: 1;
}
.tele-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tele-card__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--app-primary) 14%, transparent);
  color: var(--app-primary);
}
.tele-card--success .tele-card__icon { background: var(--app-success-weak); color: var(--app-success); }
.tele-card--warning .tele-card__icon { background: var(--app-warning-weak); color: var(--app-warning); }
.tele-card--error .tele-card__icon { background: var(--app-error-weak); color: var(--app-error); }
.tele-card__delta {
  font-family: var(--app-font-mono);
  font-size: 12px;
}
.tele-card__delta.up { color: var(--app-success); }
.tele-card__delta.down { color: var(--app-error); }
.tele-card__label {
  font-size: 12px;
  color: var(--app-text-3);
  letter-spacing: 0.02em;
}
.tele-card__value {
  font-size: 34px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}
.tele-card__suffix {
  font-size: 16px;
  font-weight: 500;
  color: var(--app-text-3);
  margin-left: 3px;
}
.tele-card__spark {
  width: 100%;
  height: 36px;
  margin-top: 4px;
  display: block;
}
.spark-line {
  stroke: var(--app-primary);
}
.tele-card--success .spark-line { stroke: var(--app-success); }
.tele-card--warning .spark-line { stroke: var(--app-warning); }
.tele-card--error .spark-line { stroke: var(--app-error); }
.spark-area {
  fill: color-mix(in srgb, var(--app-primary) 12%, transparent);
  stroke: none;
}
.tele-card--success .spark-area { fill: color-mix(in srgb, var(--app-success) 12%, transparent); }
.tele-card--warning .spark-area { fill: color-mix(in srgb, var(--app-warning) 12%, transparent); }
.tele-card--error .spark-area { fill: color-mix(in srgb, var(--app-error) 12%, transparent); }
</style>
