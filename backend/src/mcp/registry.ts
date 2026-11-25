import { callRoute, checkActionScope, resultPayload } from './invoker.js';
import type { ActionDef, McpContext, ToolArgs, ToolDef } from './types.js';
import { McpToolError } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  constructor(defs: ToolDef[]) {
    for (const tool of defs) this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listTools(ctx: McpContext): any[] {
    const list: any[] = [];
    for (const tool of this.tools.values()) {
      const actions = this.availableActions(tool, ctx.level);
      if (!Object.keys(actions).length) continue;
      list.push(this.buildSchema(tool, actions));
    }
    return list;
  }

  async call(ctx: McpContext, name: string, args: ToolArgs): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) return resultPayload({ code: -1, msg: `未知工具：${name}` }, true);
    const actions = tool.actions;
    let actionName = args.action;
    if (actionName === undefined || actionName === null || actionName === '') {
      if (Object.keys(actions).length === 1) actionName = Object.keys(actions)[0];
    }
    if (typeof actionName !== 'string' || !actions[actionName]) {
      return resultPayload({ code: -1, msg: `action 参数无效，可选值：${Object.keys(actions).join(', ')}` }, true);
    }
    const action = actions[actionName];
    if (ctx.level < Number(action.level ?? 2)) {
      return resultPayload({ code: -1, msg: '无权限' }, true);
    }
    for (const key of tool.required || []) {
      const value = args[key];
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return resultPayload({ code: -1, msg: `缺少必填参数：${key}` }, true);
      }
    }

    let callArgs: ToolArgs = { ...args };
    delete callArgs.action;
    let data: any;
    try {
      checkActionScope(ctx, action);
      await this.applyDefaults(callArgs, action);
      if (action.before) callArgs = await action.before(callArgs, ctx);
      if (action.handler) {
        data = await action.handler(callArgs, ctx);
      } else if (action.request) {
        const spec = await action.request(callArgs, ctx);
        if (Array.isArray(spec)) {
          data = [];
          for (const item of spec) data.push(await callRoute(ctx, item));
        } else {
          data = await callRoute(ctx, spec);
        }
      } else {
        throw new McpToolError('该操作未实现');
      }
      if (action.after && !(data && typeof data === 'object' && data.code !== undefined && Number(data.code) !== 0)) {
        data = action.after(data, callArgs, ctx);
      }
    } catch (e: any) {
      if (e instanceof McpToolError) {
        data = { code: -1, msg: e.message };
      } else {
        console.error(`[mcp] 工具执行异常 ${name}.${actionName}:`, e?.message || e);
        data = { code: -1, msg: '执行出错，请稍后重试' };
      }
    }
    return resultPayload(data);
  }

  private async applyDefaults(args: ToolArgs, action: ActionDef): Promise<void> {
    for (const [key, value] of Object.entries(action.defaults || {})) {
      if (args[key] === undefined || args[key] === null || args[key] === '') args[key] = value;
    }
  }

  private availableActions(tool: ToolDef, level: number): Record<string, ActionDef> {
    const out: Record<string, ActionDef> = {};
    for (const [name, action] of Object.entries(tool.actions)) {
      if (level >= Number(action.level ?? 2)) out[name] = action;
    }
    return out;
  }

  private buildSchema(tool: ToolDef, actions: Record<string, ActionDef>): any {
    const properties: Record<string, any> = {};
    const required = [...(tool.required || [])];
    let description = tool.description;
    if (Object.keys(tool.actions).length > 1) {
      properties.action = {
        type: 'string',
        enum: Object.keys(actions),
        description: '要执行的操作',
      };
      required.unshift('action');
      description += '\n\naction 可选值：';
      for (const [key, action] of Object.entries(actions)) description += `\n- ${key}：${action.desc}`;
    }
    Object.assign(properties, tool.properties || {});
    const inputSchema: any = {
      type: 'object',
      properties: Object.keys(properties).length ? properties : {},
    };
    if (required.length) inputSchema.required = [...new Set(required)];
    return {
      name: tool.name,
      title: tool.title,
      description,
      inputSchema,
      annotations: {
        title: tool.title,
        readOnlyHint: tool.readOnly ?? false,
        destructiveHint: tool.destructive ?? false,
        openWorldHint: true,
      },
    };
  }
}
