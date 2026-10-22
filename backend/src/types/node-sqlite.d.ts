declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    iterate(...params: any[]): IterableIterator<any>;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    timeout?: number;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
    function(name: string, fn: (...args: any[]) => any): void;
    aggregate(name: string, options: Record<string, any>): void;
  }
}
