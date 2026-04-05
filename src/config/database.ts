import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { SUPABASE_PROJECT_REF, SUPABASE_PROJECT_URL } from './constants';

type SqlParam = string | number | boolean | Date | null | undefined;

interface QueryMetadata {
  affectedRows: number;
  insertId: number | null;
  rowCount: number;
}

type QueryResponse<T extends QueryResultRow = QueryResultRow> = [T[], QueryMetadata];

interface QueryableClient {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParam[]): Promise<QueryResult<T>>;
}

export interface DatabaseExecutor {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParam[]): Promise<QueryResponse<T>>;
  execute<T extends QueryResultRow = QueryResultRow>(sql: string, params?: SqlParam[]): Promise<QueryResponse<T>>;
}

export interface DatabaseConnection extends DatabaseExecutor {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

function replacePlaceholders(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function needsReturning(sql: string) {
  return /^\s*insert\s+into/i.test(sql) && !/\breturning\b/i.test(sql);
}

function normalizeSql(sql: string) {
  const withPlaceholders = replacePlaceholders(sql);
  if (needsReturning(withPlaceholders)) {
    return `${withPlaceholders.trimEnd()} RETURNING id`;
  }
  return withPlaceholders;
}

function buildMetadata(result: QueryResult<QueryResultRow>): QueryMetadata {
  return {
    affectedRows: result.rowCount || 0,
    insertId: result.rows?.[0]?.id ?? null,
    rowCount: result.rowCount || 0,
  };
}

async function runQuery<T extends QueryResultRow = QueryResultRow>(
  client: QueryableClient,
  sql: string,
  params: SqlParam[] = [],
): Promise<QueryResponse<T>> {
  const result = await client.query<T>(normalizeSql(sql), params);
  return [result.rows, buildMetadata(result)];
}

function wrapClient(client: PoolClient): DatabaseConnection {
  return {
    query(sql, params = []) {
      return runQuery(client, sql, params);
    },
    execute(sql, params = []) {
      return runQuery(client, sql, params);
    },
    async beginTransaction() {
      await client.query('BEGIN');
    },
    async commit() {
      await client.query('COMMIT');
    },
    async rollback() {
      await client.query('ROLLBACK');
    },
    release() {
      client.release();
    },
  };
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ssl =
  (process.env.PGSSL || process.env.DB_SSL) === 'false'
    ? false
    : { rejectUnauthorized: false };

const rawPool = connectionString
  ? new Pool({
      connectionString,
      ssl,
      max: Number(process.env.DB_POOL_MAX || 10),
    })
  : new Pool({
      host: process.env.PGHOST || process.env.DB_HOST || `db.${SUPABASE_PROJECT_REF}.supabase.co`,
      port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
      database: process.env.PGDATABASE || process.env.DB_NAME || 'postgres',
      user: process.env.PGUSER || process.env.DB_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
      ssl,
      max: Number(process.env.DB_POOL_MAX || 10),
    });

rawPool.on('error', (error) => {
  console.error('Erro no pool PostgreSQL/Supabase:', error);
});

export const pool: DatabaseExecutor & {
  getConnection(): Promise<DatabaseConnection>;
  end(): Promise<void>;
} = {
  query(sql, params = []) {
    return runQuery(rawPool, sql, params);
  },
  execute(sql, params = []) {
    return runQuery(rawPool, sql, params);
  },
  async getConnection() {
    const client = await rawPool.connect();
    return wrapClient(client);
  },
  async end() {
    await rawPool.end();
  },
};

export function logDatabaseConfig() {
  const host =
    process.env.PGHOST ||
    process.env.DB_HOST ||
    (connectionString ? 'DATABASE_URL' : `db.${SUPABASE_PROJECT_REF}.supabase.co`);

  if (!connectionString && !process.env.PGPASSWORD && !process.env.DB_PASSWORD) {
    console.warn(
      `Banco configurado para ${SUPABASE_PROJECT_URL} (${host}), mas PGPASSWORD/DB_PASSWORD nao foi definido.`,
    );
  }
}
