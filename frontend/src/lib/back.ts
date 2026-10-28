import { onUnmounted } from 'vue';
import { useRouter } from 'vue-router';

/**
 * 返回上一页；当浏览器没有可返回的历史（新标签直接打开、iframe 预览、深链进入等）时，
 * 回退到指定的父级路由，保证左上角返回箭头始终有响应。
 */
export function useBack(fallback: string) {
  const router = useRouter();
  let disposed = false;
  let timer: number | undefined;
  // 组件卸载后不再执行延迟跳转，避免对已销毁页面触发导航
  onUnmounted(() => {
    disposed = true;
    if (timer) window.clearTimeout(timer);
  });
  return () => {
    const before = router.currentRoute.value.fullPath;
    router.back();
    timer = window.setTimeout(() => {
      if (disposed) return;
      // 300ms 内路由未变化说明没有可返回的历史，回退到父级页面
      if (router.currentRoute.value.fullPath === before) router.push(fallback);
    }, 300);
  };
}