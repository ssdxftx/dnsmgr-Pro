import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export const BREAKPOINT_MOBILE = 768;
export const BREAKPOINT_TABLET = 1024;

export function useResponsive() {
  const width = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);

  const update = () => {
    width.value = window.innerWidth;
  };

  onMounted(() => {
    update();
    window.addEventListener('resize', update, { passive: true });
  });
  onBeforeUnmount(() => window.removeEventListener('resize', update));

  const isMobile = computed(() => width.value < BREAKPOINT_MOBILE);
  const isTablet = computed(() => width.value >= BREAKPOINT_MOBILE && width.value < BREAKPOINT_TABLET);
  const isDesktop = computed(() => width.value >= BREAKPOINT_TABLET);

  return { width, isMobile, isTablet, isDesktop };
}