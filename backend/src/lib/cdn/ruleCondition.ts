// EdgeOne（EO）规则条件的匹配类型与运算符。
// 说明：官方 DescribeRulesSetting 只返回「可执行动作」及其属性定义，条件部分需内置。
// 取值与官方 API 2022-09-01 RuleCondition 数据结构完全一致：
//   Operator: equal | notEquals | exist | notexist   （注意 notEquals 为官方拼写）
//   Target  : filename | extension | host | full_url | url | client_country |
//             query_string | request_header | client_ip | request_protocol |
//             request_method | all
//   Name    : 仅 query_string / request_header 需要参数名
//   IgnoreCase : 是否忽略大小写
//   all     : 站点任意请求（Values 固定为 ['all']）
// 供前端条件编辑器渲染下拉，避免手写表达式字符串。

export const EO_CONDITION_OPERATORS: string[] = ['equal', 'notEquals', 'exist', 'notexist'];

export const EO_CONDITION_TARGETS: string[] = [
  'host',
  'url',
  'full_url',
  'query_string',
  'extension',
  'filename',
  'request_header',
  'client_country',
  'request_protocol',
  'client_ip',
  'request_method',
  'all',
];

/** exist / notexist 这两个运算符不需要提供取值 */
export const EO_CONDITION_TARGETS_WITHOUT_VALUE: string[] = ['exist', 'notexist'];

export const EO_CONDITION_SCHEMA = {
  operators: EO_CONDITION_OPERATORS,
  targets: EO_CONDITION_TARGETS,
  valueOptionalOperators: EO_CONDITION_TARGETS_WITHOUT_VALUE,
};
