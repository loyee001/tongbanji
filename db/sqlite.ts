import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

type Row = Record<string, unknown>;
export type SqliteResult<T = Row> = {
  success: true;
  results: T[];
  meta: { changes: number; last_row_id?: number };
};

export class SqliteStatement {
  readonly database: SqliteDatabase;
  readonly sql: string;
  readonly values: SQLInputValue[];

  constructor(database: SqliteDatabase, sql: string, values: SQLInputValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: SQLInputValue[]): SqliteStatement {
    return new SqliteStatement(this.database, this.sql, values);
  }

  first<T = Row>(): T | null {
    const result = this.database.connection().prepare(this.sql).get(...this.values);
    return result === undefined ? null : { ...result } as T;
  }

  all<T = Row>(): SqliteResult<T> {
    const rows = this.database.connection().prepare(this.sql).all(...this.values);
    return { success: true, results: rows.map(row => ({ ...row }) as T), meta: { changes: 0 } };
  }

  run(): SqliteResult {
    const result = this.database.connection().prepare(this.sql).run(...this.values);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  execute<T = Row>(): SqliteResult<T> {
    const statement = this.database.connection().prepare(this.sql);
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.values).map(row => ({ ...row }) as T),
        meta: { changes: 0 },
      };
    }
    const result = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }
}

export class SqliteDatabase {
  #sqlite: DatabaseSync;
  #closed = false;

  constructor(path: string, options: { migrationsDir?: string } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.#sqlite = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
    try {
      this.#sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
      this.migrate(resolve(options.migrationsDir ?? resolve(process.cwd(), 'drizzle')));
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  connection(): DatabaseSync {
    if (this.#closed) throw new Error('The classroom database is closed.');
    return this.#sqlite;
  }

  prepare(sql: string): SqliteStatement {
    this.connection();
    return new SqliteStatement(this, sql);
  }

  batch<T = Row>(statements: SqliteStatement[]): SqliteResult<T>[] {
    if (statements.some(statement => statement.database !== this)) {
      throw new Error('Every batch statement must belong to the same database.');
    }
    return this.transaction(() => statements.map(statement => statement.execute<T>()));
  }

  transaction<T>(work: () => T): T {
    const sqlite = this.connection();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      // Keep the complete transaction synchronous so another request cannot interleave.
      const result = work();
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#sqlite.close();
    this.#closed = true;
  }

  private migrate(migrationsDir: string): void {
    const migrations = readdirSync(migrationsDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
      .map(entry => entry.name)
      .sort()
      .map(filename => {
        const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
        return { filename, sql, checksum: createHash('sha256').update(sql).digest('hex') };
      });
    if (migrations.length === 0) throw new Error(`No SQL migrations found in ${migrationsDir}.`);
    const sqlite = this.connection();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(`CREATE TABLE IF NOT EXISTS _tongbanji_migrations (
        filename TEXT PRIMARY KEY NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`);
      const applied = sqlite.prepare('SELECT filename, checksum FROM _tongbanji_migrations').all();
      const available = new Map(migrations.map(migration => [migration.filename, migration]));
      for (const previous of applied) {
        const migration = available.get(String(previous.filename));
        if (!migration) throw new Error(`Applied migration is missing: ${previous.filename}`);
        if (migration.checksum !== previous.checksum) {
          throw new Error(`Applied migration checksum changed: ${previous.filename}`);
        }
      }
      const appliedNames = new Set(applied.map(previous => String(previous.filename)));
      const remember = sqlite.prepare('INSERT INTO _tongbanji_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)');
      for (const migration of migrations) {
        if (appliedNames.has(migration.filename)) continue;
        sqlite.exec(migration.sql);
        remember.run(migration.filename, migration.checksum, new Date().toISOString());
      }
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

const globalDatabase = globalThis as typeof globalThis & { __tongbanjiSqlite?: SqliteDatabase };

export function database(): SqliteDatabase {
  if (!globalDatabase.__tongbanjiSqlite || globalDatabase.__tongbanjiSqlite.isClosed) {
    const dataDir = resolve(process.env.DATA_DIR || resolve(process.cwd(), 'data'));
    globalDatabase.__tongbanjiSqlite = new SqliteDatabase(resolve(dataDir, 'classroom.sqlite'));
  }
  return globalDatabase.__tongbanjiSqlite;
}
