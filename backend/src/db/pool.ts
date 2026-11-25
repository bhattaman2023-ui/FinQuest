import { Pool } from 'pg';
import { PGlite, Transaction } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

type QueryResult<T> = { rows: T[]; rowCount: number };
type Queryable = {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
};
type DatabaseClient = Queryable & { release(): void };

const usePGlite = process.env.DB_DRIVER === 'pglite';
const connectionString = process.env.DATABASE_URL;
const pgliteDataDir = process.env.PGLITE_DATA_DIR || path.resolve(__dirname, '../../.local-data/finquest');

if (usePGlite) fs.mkdirSync(path.dirname(pgliteDataDir), { recursive: true });

const embeddedDb = usePGlite
  ? new PGlite(pgliteDataDir)
  : undefined;

const postgresPool = usePGlite
  ? undefined
  : new Pool(
      connectionString
        ? { connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }
        : {
            host:     process.env.DB_HOST || 'localhost',
            port:     parseInt(process.env.DB_PORT || '5432', 10),
            database: process.env.DB_NAME || 'finquest',
            user:     process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'password',
            ssl:      false,
          }
    );

postgresPool?.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function execute<T>(
  db: PGlite | Transaction,
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  let rows: T[];
  let rowCount: number;
  if (params?.length) {
    const result = await db.query<T>(sql, params);
    rows = result.rows;
    rowCount = result.rowCount ?? result.affectedRows ?? 0;
  } else {
    const result = (await db.exec(sql)).slice(-1)[0];
    rows = (result?.rows ?? []) as T[];
    rowCount = result?.rowCount ?? result?.affectedRows ?? 0;
  }
  return {
    rows,
    rowCount,
  };
}

export const pool = {
  async connect(): Promise<DatabaseClient> {
    if (embeddedDb) {
      return {
        query: <T = Record<string, any>>(sql: string, params?: unknown[]) =>
          execute<T>(embeddedDb, sql, params),
        release: () => undefined,
      };
    }

    const client = await postgresPool!.connect();
    return {
      query: async <T = Record<string, any>>(sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
      },
      release: () => client.release(),
    };
  },
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (embeddedDb) return execute<T>(embeddedDb, sql, params);
    const result = await postgresPool!.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  },
  async end(): Promise<void> {
    if (embeddedDb) await embeddedDb.close();
    else await postgresPool!.end();
  }
};

/** Execute a query. Throws on error. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = await pool.connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

/** Run a function inside a transaction. Rolls back on error. */
export async function withTransaction<T>(
  fn: (client: Queryable) => Promise<T>
): Promise<T> {
  if (embeddedDb) {
    return embeddedDb.transaction((tx) =>
      fn({
        query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          execute<R>(tx, sql, params),
      })
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
