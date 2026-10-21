import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export const BREAKPOINT_MOBILE = 768;
export const BREAKPOINT_TABLET = 1024;

// 模块级单例：同一页面多个组件共享一次 resize 监听与一次宽度更新，
// 避免每个 useResponsive 实例都注册监听并在拖动窗口时重复计算。
const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
let subscribers = 0;
let raf = 0;

function onResize() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    width.value = window.innerWidth;
  });
}

function subscribe() {
  if (typeof window === 'undefined') return;
  if (subscribers++ === 0) window.addEventListener('resize', onResize, { passive: true });
}

function unsubscribe() {
  if (typeof window === 'undefined') return;
  if (subscribers > 0 && --subscribers === 0) {
    window.removeEventListener('resize', onResize);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
}

export function useResponsive() {
  onMounted(() => {
    width.value = window.innerWidth;
    subscribe();
  });
  onBeforeUnmount(unsubscribe);

  const isMobile = computed(() => width.value < BREAKPOINT_MOBILE);
  const isTablet = computed(() => width.value >= BREAKPOINT_MOBILE && width.value < BREAKPOINT_TABLET);
  const isDesktop = computed(() => width.value >= BREAKPOINT_TABLET);

  return { width, isMobile, isTablet, isDesktop };
}
