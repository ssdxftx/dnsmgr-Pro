import type { Directive } from 'vue';

/**
 * v-reveal —— 入场编排指令。
 * 用法：<div v-reveal class="d1">（d1..d5 控制错峰延迟，见 tokens.css）。
 * 进入视口时加 .is-in 触发过渡；reduced-motion 下直接可见。
 * 带 1s 兜底，确保任何环境下内容不会停留在不可见状态。
 */

const reduce =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let io: IntersectionObserver | null = null;

function getIO(): IntersectionObserver | null {
  if (io || typeof IntersectionObserver === 'undefined') return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('is-in');
          io?.unobserve(e.target);
        }
      }
    },
    { threshold: 0.08 },
  );
  return io;
}

export const vReveal: Directive = {
  mounted(el: HTMLElement) {
    el.classList.add('reveal');
    if (reduce) {
      el.classList.add('is-in');
      return;
    }
    getIO()?.observe(el);
    // 兜底：避免极端情况下元素停留在透明态
    window.setTimeout(() => el.classList.add('is-in'), 1000);
  },
  unmounted(el: HTMLElement) {
    io?.unobserve(el);
  },
};
