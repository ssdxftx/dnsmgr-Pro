import { computed, ref } from 'vue';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'dnsmgr_theme';
const mode = ref<ThemeMode>('light');

function apply(next: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
}

function detectInitial(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  // 默认暗色：营造「玻璃控制塔」氛围（用户仍可手动切换亮色，偏好会被记忆）
  return 'dark';
}

mode.value = detectInitial();
apply(mode.value);

const isDark = computed(() => mode.value === 'dark');

export function useThemeMode() {
  const setMode = (next: ThemeMode) => {
    mode.value = next;
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };
  const toggle = () => setMode(isDark.value ? 'light' : 'dark');

  return { mode, isDark, setMode, toggle };
}