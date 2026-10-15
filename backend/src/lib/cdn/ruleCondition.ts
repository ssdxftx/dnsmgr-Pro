// EdgeOne（EO）规则条件的匹配类型与运算符。
// 说明：官方 DescribeRulesSetting 只返回「可执行动作」及其属性定义，条件部分需内置。
// 以下取值取自官方 RuleCondition 模型：
//   Operator: equal | notequal | exist | notexist
//   Target  : filename | extension | host | full_url | url | client_country |
//             query_string | request_header | client_ip | request_protocol | request_method
// 供前端条件编辑器渲染下拉，避免手写表达式字符串。

export const EO_CONDITION_OPERATORS: string[] = ['equal', 'notequal', 'exist', 'notexist'];

export const EO_CONDITION_TARGETS: string[] = [
  'filename',
  'extension',
  'host',
  'full_url',
  'url',
  'client_country',
  'query_string',
  'request_header',
  'client_ip',
  'request_protocol',
  'request_method',
];

/** exist / notexist 这两个运算符不需要提供取值 */
export const EO_CONDITION_TARGETS_WITHOUT_VALUE: string[] = ['exist', 'notexist'];

export const EO_CONDITION_SCHEMA = {
  operators: EO_CONDITION_OPERATORS,
  targets: EO_CONDITION_TARGETS,
  valueOptionalOperators: EO_CONDITION_TARGETS_WITHOUT_VALUE,
};
