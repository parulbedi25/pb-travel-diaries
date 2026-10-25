/**
 * The MySQL/MariaDB repository.
 *
 * Connection/transaction management for MySQL. Parameterized repository
 * queries are shared with the SQLite driver in sqlRepository.js.
 *
 * Values that are JSON (site content, revisions, settings) are stored as text
 * and handed back as text; parsing belongs to the route layer.
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";
import { createSqlRepository } from "./sqlRepository.js";
export { REVISION_LIMIT } from "./sqlRepository.js";
import { applySchema, planMigrations } from "./schema.js";


export async function createMysqlRepo() {
  const pool = mysql.createPool({
    ...config.db,
    multipleStatements: false,
    waitForConnections: true,
    charset: "utf8mb4",
    // MariaDB reports BIGINT and DECIMAL as strings otherwise; ids stay numbers.
    supportBigNumbers: true,
    bigNumberStrings: false,
    timezone: "Z",
  });

  /**
   * Run a set of statements as one unit, handing the caller a connection.
   * Used wherever a half-finished write would be worse than no write at all.
   */
  async function transaction(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        /* the connection is already gone; nothing to roll back */
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  return createSqlRepository({
    pool,
    transaction,
    kind: "mysql",
    migrate: () => applySchema(pool),
    schemaStatus: () => planMigrations(pool),
  });
}
