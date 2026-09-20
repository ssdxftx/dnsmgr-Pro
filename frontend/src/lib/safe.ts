// 前端安全工具：字段显隐表达式求值 + 密钥字段识别

export const SECRET_MASK = '**********';

const SECRET_KEY_RE = /(secret|password|passwd|pwd|token|apikey|api_key|private_?key|accesskey|credential)/i;

// 判断配置项是否为敏感字段（用于以密码框渲染、避免明文回显）
export function isSecretField(name: string | number): boolean {
  const k = String(name || '');
  if (SECRET_KEY_RE.test(k)) return true;
  if (/(^|_)key$/i.test(k)) return true;
  return ['SecretId', 'AccessKeyId', 'api_password'].includes(k);
}

type Tok = { t: 'id' | 'num' | 'str' | 'op' | 'punc'; v: string };

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      toks.push({ t: 'punc', v: c });
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      let j = i + 1;
      while (j < expr.length && expr[j] !== q) j++;
      if (j >= expr.length) throw new Error('unterminated string');
      toks.push({ t: 'str', v: expr.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const three = expr.slice(i, i + 3);
    const two = expr.slice(i, i + 2);
    if (three === '===' || three === '!==') {
      toks.push({ t: 'op', v: three });
      i += 3;
      continue;
    }
    if (['==', '!=', '&&', '||', '>=', '<='].includes(two)) {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '!' || c === '>' || c === '<') {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      toks.push({ t: 'num', v: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_$.]/.test(expr[j])) j++;
      toks.push({ t: 'id', v: expr.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error('unexpected token: ' + c);
  }
  return toks;
}

function resolveId(id: string, config: Record<string, any>): any {
  return id.split('.').reduce<any>((o, k) => (o === null || o === undefined ? undefined : o[k]), config);
}

// 仅支持标识符 / 字符串 / 数字 / 比较运算 / && || ! / 括号，杜绝任意代码执行
export function evalShow(expr: string | undefined, config: Record<string, any>): boolean {
  if (!expr) return true;
  try {
    const toks = tokenize(String(expr));
    let pos = 0;
    const peek = () => toks[pos];
    const eat = () => toks[pos++];
    const lit = (t: Tok): any => (t.t === 'num' ? Number(t.v) : t.t === 'str' ? t.v : resolveId(t.v, config));
    const cmpOperators = ['==', '!=', '===', '!==', '>=', '<=', '>', '<'];

    const operand = (): any => {
      const t = eat();
      if (!t) throw new Error('unexpected end');
      if (t.t === 'punc' && t.v === '(') {
        const v = parseOr();
        const close = eat();
        if (!close || close.v !== ')') throw new Error('expected )');
        return v;
      }
      if (t.t === 'op' && t.v === '!') return !operand();
      if (t.t === 'id' || t.t === 'str' || t.t === 'num') return lit(t);
      throw new Error('unexpected token');
    };

    const primary = (): any => {
      const left = operand();
      const nxt = peek();
      if (nxt && nxt.t === 'op' && cmpOperators.includes(nxt.v)) {
        eat();
        const right = operand();
        switch (nxt.v) {
          case '==':
          case '===':
            return String(left) === String(right);
          case '!=':
          case '!==':
            return String(left) !== String(right);
          case '>=':
            return Number(left) >= Number(right);
          case '<=':
            return Number(left) <= Number(right);
          case '>':
            return Number(left) > Number(right);
          case '<':
            return Number(left) < Number(right);
        }
      }
      return left;
    };

    const parseAnd = (): any => {
      let v = primary();
      while (peek() && peek().t === 'op' && peek().v === '&&') {
        eat();
        const r = primary();
        v = !!v && !!r;
      }
      return v;
    };
    const parseOr = (): any => {
      let v = parseAnd();
      while (peek() && peek().t === 'op' && peek().v === '||') {
        eat();
        const r = parseAnd();
        v = !!v || !!r;
      }
      return v;
    };
    return !!parseOr();
  } catch {
    // 表达式无法解析时按显示处理，行为与旧实现一致
    return true;
  }
}