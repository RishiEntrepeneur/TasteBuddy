import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Lazily-created Postgres pool.
 *
 * Serverless route handlers are re-entered on every cold start, so the pool is
 * cached on `globalThis` to survive Next's dev-mode module reloads and to keep
 * warm lambdas from opening a new connection per request.
 */

declare global {
  var __tasteBuddyPool: Pool | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. TasteBuddy falls back to the seed dataset; " +
        "call isDatabaseConfigured() before getPool().",
    );
  }

  if (!globalThis.__tasteBuddyPool) {
    globalThis.__tasteBuddyPool = new Pool({
      connectionString,
      // Managed Postgres (Supabase/Neon/RDS) terminates plaintext connections.
      ssl:
        process.env.PGSSLMODE === "disable"
          ? undefined
          : { rejectUnauthorized: false },
      // Serverless containers should hold very few sockets each.
      max: Number(process.env.PGPOOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalThis.__tasteBuddyPool;
}

/** Parameterised query helper — every call site uses placeholders, never string concat. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
