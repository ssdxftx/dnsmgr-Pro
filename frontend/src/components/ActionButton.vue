<template>
  <n-button
    v-bind="$attrs"
    :loading="busy"
    :disabled="busy || disabled"
    @click="onClick"
  >
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps || {}" />
    </template>
  </n-button>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { NButton, useMessage } from 'naive-ui';

const props = withDefaults(
  defineProps<{
    /** 点击后执行的动作；可返回 Promise，也可直接返回 api() 结果 */
    action: () => Promise<any> | any;
    /** 成功提示；留空则静默（用于开关类操作） */
    success?: string;
    /** 失败兜底文案 */
    errorText?: string;
    /** 最短转圈时长，避免极快请求一闪而过 */
    minMs?: number;
    /** 外部禁用条件（与忙态叠加） */
    disabled?: boolean;
    /** 成功后优先展示后端返回的 msg（用于测试类操作） */
    successFromResult?: boolean;
  }>(),
  { success: '', errorText: '', minMs: 320, disabled: false, successFromResult: false },
);

const busy = ref(false);
const message = useMessage();

async function onClick() {
  if (busy.value) return;
  busy.value = true;
  const t0 = Date.now();
  try {
    const res = await props.action();
    if (res && typeof res === 'object' && typeof res.code === 'number') {
      if (res.code === 0) {
        const ok = props.successFromResult && res.msg ? res.msg : props.success;
        if (ok) message.success(ok);
      } else {
        message.error(res.msg || props.errorText || '操作失败');
      }
    } else if (props.success) {
      message.success(props.success);
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') message.error(e?.message || props.errorText || '操作失败');
  } finally {
    const rest = props.minMs - (Date.now() - t0);
    if (rest > 0) await new Promise((r) => setTimeout(r, rest));
    busy.value = false;
  }
}
</script>
