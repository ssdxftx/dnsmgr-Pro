export interface PreparedSql {
  sql: string;
  params: any[];
}

function cleanIdent(value: string): string {
  return String(value || '').replace(/`/g, '').replace(/[^A-Za-z0-9_]/g, '_');
}

export function sqliteIndexName(tableName: string, indexName: string): string {
  return `${cleanIdent(tableName)}_${cleanIdent(indexName)}`;
}

function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  );
}

function normalizeScalar(value: any): any {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return formatDate(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === 'object') {
    // mysql2 会把普通对象/数组序列化为 JSON；SQLite 只接受标量，保持同样的落库结果。
    return JSON.stringify(value);
  }
  return value;
}

/**
 * mysql2 支持 SET ? / VALUES ? 这类对象/二维数组绑定，node:sqlite 只接受标量参数。
 * 在进入 SQLite 前展开为显式列和占位符。
 */
export function expandParams(sql: string, params: any[] = []): PreparedSql {
  const list = params;

  if (/\bSET\s+\?/i.test(sql) && list.length > 0) {
    const obj = list[0];
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Uint8Array)) {
      const keys = Object.keys(obj);
      const values = keys.map((key) => normalizeScalar((obj as any)[key]));
      if (/^\s*INSERT\s+INTO\b/i.test(sql.trim())) {
        const columns = keys.map((key) => `\`${key}\``).join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        return {
          sql: sql.replace(/\bSET\s+\?/i, `(${columns}) VALUES (${placeholders})`),
          params: [...values, ...list.slice(1).map(normalizeScalar)],
        };
      }
      const assignments = keys.map((key) => `\`${key}\` = ?`).join(', ');
      return {
        sql: sql.replace(/\bSET\s+\?/i, `SET ${assignments}`),
        params: [...values, ...list.slice(1).map(normalizeScalar)],
      };
    }
  }

  const valuesMatch = /\bVALUES\s+\?/i.exec(sql);
  if (valuesMatch) {
    const index = list.findIndex(
      (value) => Array.isArray(value) && value.length > 0 && Array.isArray(value[0]),
    );
    if (index >= 0) {
      const rows = list[index] as any[][];
      const width = rows[0]?.length || 0;
      const placeholders = rows
        .map(() => `(${Array.from({ length: width }, () => '?').join(', ')})`)
        .join(', ');
      return {
        sql: sql.slice(0, valuesMatch.index) + 'VALUES ' + placeholders + sql.slice(valuesMatch.index + valuesMatch[0].length),
        params: [...list.slice(0, index).map(normalizeScalar), ...rows.flat().map(normalizeScalar), ...list.slice(index + 1).map(normalizeScalar)],
      };
    }
  }

  return { sql, params: list.map(normalizeScalar) };
}

function sqliteUnit(unit: string): string {
  const value = unit.toLowerCase();
  if (value === 'second') return 'seconds';
  if (value === 'minute') return 'minutes';
  if (value === 'hour') return 'hours';
  return 'days';
}

export function toSqliteColumnDef(definition: string): string {
  let out = String(definition || '');
  out = out.replace(/\b(?:tiny|small|medium|big)?int\s*\(\s*\d+\s*\)/gi, 'INTEGER');
  out = out.replace(/\b(?:tiny|small|medium|big)?int\b/gi, 'INTEGER');
  out = out.replace(/\b(?:var)?binary\s*\(\s*\d+\s*\)/gi, 'BLOB');
  out = out.replace(/\b(?:var)?binary\b/gi, 'BLOB');
  out = out.replace(/\bjson\b/gi, 'TEXT');
  out = out.replace(/\b(?:double|float|real|decimal\s*\([^)]*\)|numeric\s*\([^)]*\))\b/gi, 'REAL');
  out = out.replace(/\b(?:boolean|bool)\b/gi, 'INTEGER');
  out = out.replace(/\bunsigned\b/gi, '');
  out = out.replace(/\bzerofill\b/gi, '');
  out = out.replace(/\bauto_increment\b/gi, '');
  out = out.replace(/\bDEFAULT\s+CURRENT_TIMESTAMP\b/gi, "DEFAULT (datetime('now','localtime'))");
  out = out.replace(/\bCURRENT_TIMESTAMP\b/gi, "datetime('now','localtime')");
  out = out.replace(/CAST\(([^()]*)\s+AS\s+UNSIGNED\)/gi, 'CAST($1 AS INTEGER)');
  out = out.replace(/\bJSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(([^)]*)\)\s*\)/gi, 'json_extract($1)');
  out = out.replace(/\bJSON_EXTRACT\b/gi, 'json_extract');
  out = out.replace(/\bJSON_VALID\b/gi, 'json_valid');
  return out.replace(/\s+/g, ' ').trim();
}

function translateCreateTable(statement: string): string {
  const match = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*)\)[^)]*$/i.exec(
    statement.trim(),
  );
  if (!match) return statement;

  const tableName = match[1];
  const lines = match[2]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const body: string[] = [];
  const indexes: string[] = [];
  let autoIncrement = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/,$/, '').trim();
    if (!line) continue;

    if (/^PRIMARY\s+KEY\s*\(\s*`?id`?\s*\)$/i.test(line) && autoIncrement) continue;

    const keyMatch = /^KEY\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]+)\)$/i.exec(line);
    if (keyMatch) {
      const indexName = sqliteIndexName(tableName, keyMatch[1]);
      indexes.push(`CREATE INDEX IF NOT EXISTS \`${indexName}\` ON \`${tableName}\` (${keyMatch[2]});`);
      continue;
    }

    const uniqueMatch = /^UNIQUE\s+KEY\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]+)\)$/i.exec(line);
    if (uniqueMatch) {
      const indexName = sqliteIndexName(tableName, uniqueMatch[1]);
      indexes.push(`CREATE UNIQUE INDEX IF NOT EXISTS \`${indexName}\` ON \`${tableName}\` (${uniqueMatch[2]});`);
      continue;
    }

    if (/^`?id`?\s+.*\bauto_increment\b/i.test(line)) {
      autoIncrement = true;
      body.push('`id` INTEGER PRIMARY KEY AUTOINCREMENT');
      continue;
    }

    let def = toSqliteColumnDef(line);
    // 与 MySQL 默认排序规则保持一致：用户名/邮箱唯一约束与登录查询不区分大小写
    if (tableName.endsWith('user') && /^`?(?:username|email)`?\s/i.test(def) && !/\bCOLLATE\b/i.test(def)) {
      def += ' COLLATE NOCASE';
    }
    body.push(def);
  }

  if (!body.length) return statement;
  const tableSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n  ${body.join(',\n  ')}\n);`;
  return [tableSql, ...indexes].join('\n');
}

function translateAlterTable(statement: string): string {
  const indexMatch = /^\s*ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(UNIQUE\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?\s*(\([\s\S]*\))\s*$/i.exec(
    statement.trim(),
  );
  if (indexMatch) {
    const [, tableName, unique, indexName, columns] = indexMatch;
    return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS \`${sqliteIndexName(tableName, indexName)}\` ON \`${tableName}\` ${columns};`;
  }

  const columnMatch = /^\s*ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(?:COLUMN\s+)?`?([A-Za-z0-9_]+)`?\s+([\s\S]+)$/i.exec(
    statement.trim(),
  );
  if (columnMatch) {
    const [, tableName, column, definition] = columnMatch;
    let def = toSqliteColumnDef(definition);
    if (tableName.endsWith('user') && /^(?:username|email)$/i.test(column) && !/\bCOLLATE\b/i.test(def)) {
      def += ' COLLATE NOCASE';
    }
    return `ALTER TABLE \`${tableName}\` ADD COLUMN \`${column}\` ${def};`;
  }

  return statement;
}

export function translateSql(sql: string): string {
  const trimmed = sql.trim();
  if (/^CREATE\s+TABLE/i.test(trimmed)) return translateCreateTable(trimmed);
  if (/^ALTER\s+TABLE/i.test(trimmed)) return translateAlterTable(trimmed);

  let out = sql;
  out = out.replace(/\bINSERT\s+IGNORE\b/gi, 'INSERT OR IGNORE');

  const hadUpsert = /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(out);
  out = out.replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/gi, 'ON CONFLICT DO UPDATE SET');
  if (hadUpsert) {
    out = out.replace(/\bVALUES\s*\(\s*`?([A-Za-z0-9_]+)`?\s*\)/gi, 'excluded.$1');
  }

  out = out.replace(
    /DATE_(ADD|SUB)\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\?|\d+)\s+(SECOND|MINUTE|HOUR|DAY)\s*\)/gi,
    (_match, operation: string, amount: string, unit: string) => {
      const sign = operation.toUpperCase() === 'ADD' ? '+' : '-';
      const suffix = sqliteUnit(unit);
      if (amount === '?') {
        return `datetime('now','localtime','${sign}' || ? || ' ${suffix}')`;
      }
      return `datetime('now','localtime','${sign}${amount} ${suffix}')`;
    },
  );

  out = out.replace(
    /NOW\(\)\s*([+-])\s*INTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY)/gi,
    (_match, sign: string, amount: string, unit: string) =>
      `datetime('now','localtime','${sign}${amount} ${sqliteUnit(unit)}')`,
  );

  out = out.replace(/\bCURDATE\(\)/gi, "date('now','localtime')");
  out = out.replace(/\bNOW\(\)/gi, "datetime('now','localtime')");

  out = out.replace(
    /GROUP_CONCAT\(([\s\S]*?)\s+ORDER\s+BY\s+([\s\S]*?)\s+SEPARATOR\s+'([^']*)'\)/gi,
    (_match, expression: string, order: string, separator: string) =>
      `GROUP_CONCAT(${expression}, '${separator}' ORDER BY ${order})`,
  );
  out = out.replace(
    /GROUP_CONCAT\(([\s\S]*?)\s+SEPARATOR\s+'([^']*)'\)/gi,
    (_match, expression: string, separator: string) => `GROUP_CONCAT(${expression}, '${separator}')`,
  );

  out = out.replace(
    /TRIM\(\s*TRAILING\s+'([^']*)'\s+FROM\s+([^)]+)\)/gi,
    (_match, chars: string, expression: string) => `RTRIM(${expression}, '${chars}')`,
  );
  out = out.replace(/\bGREATEST\(([^()]*)\)/gi, 'MAX($1)');
  out = out.replace(/CAST\(([^()]*)\s+AS\s+UNSIGNED\)/gi, 'CAST($1 AS INTEGER)');
  out = out.replace(/\bJSON_UNQUOTE\s*\(\s*JSON_EXTRACT\s*\(([^)]*)\)\s*\)/gi, 'json_extract($1)');
  out = out.replace(/\bJSON_EXTRACT\b/gi, 'json_extract');
  out = out.replace(/\bJSON_VALID\b/gi, 'json_valid');
  out = out.replace(/\bDEFAULT\s+CURRENT_TIMESTAMP\b/gi, "DEFAULT (datetime('now','localtime'))");
  out = out.replace(/\bCURRENT_TIMESTAMP\b/gi, "datetime('now','localtime')");

  return out;
}

export function splitSqlStatements(sql: string): string[] {
  return String(sql || '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function translateSchema(sql: string): string {
  const statements = splitSqlStatements(sql)
    .map((statement) => translateSql(statement).replace(/;+$/g, '').trim())
    .filter(Boolean);
  return statements.join(';\n') + ';';
}
