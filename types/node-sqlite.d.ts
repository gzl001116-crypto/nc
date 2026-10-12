declare module "node:sqlite" {
  export interface StatementResult {
    changes: number;
    lastInsertRowid: number;
  }

  export type SqlValue = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    run(...params: SqlValue[]): StatementResult;
    get(...params: SqlValue[]): Record<string, unknown> | undefined;
    all(...params: SqlValue[]): Array<Record<string, unknown>>;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
