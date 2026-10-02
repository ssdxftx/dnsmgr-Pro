// 汇总 zh-CN 下所有命名空间模块；各业务阶段新增自己的模块文件即可自动生效。
const modules = import.meta.glob('./zh-CN/*.ts', { eager: true, import: 'default' });

const messages: Record<string, unknown> = {};
for (const mod of Object.values(modules)) {
  if (mod && typeof mod === 'object') Object.assign(messages, mod as Record<string, unknown>);
}

export default messages;
