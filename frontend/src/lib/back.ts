import { useRouter } from 'vue-router';

/**
 * 返回上一页；当浏览器没有可返回的历史（新标签直接打开、iframe 预览、深链进入等）时，
 * 回退到指定的父级路由，保证左上角返回箭头始终有响应。
 */
export function useBack(fallback: string) {
  const router = useRouter();
  return () => {
    const before = router.currentRoute.value.fullPath;
    router.back();
    window.setTimeout(() => {
      // 300ms 内路由未变化说明没有可返回的历史，回退到父级页面
      if (router.currentRoute.value.fullPath === before) router.push(fallback);
    }, 300);
  };
}