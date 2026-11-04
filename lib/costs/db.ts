/**
 * MySQL access for the cost tables (database/schema.sql). Server-side only.
 *
 * Configure with MYSQL_URL (mysql://user:password@host:3306/database) or MYSQL_HOST / MYSQL_PORT / MYSQL_USER /
 * MYSQL_PASSWORD / MYSQL_DATABASE.
 *
 * TLS (hosted databases): MYSQL_SSL=true verifies the server certificate. For a server with a self-signed certificate
 * either point MYSQL_SSL_CA at its CA file (or paste the PEM) - verified and recommended - or set MYSQL_SSL=no-verify,
 * which encrypts the connection but does not authenticate the server.
 */

export class CostDbError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "CostDbError";
  }
}

export type QueryResult = { rows: Record<string, unknown>[]; affectedRows: number; insertId: number };
/** The only database surface the repository needs, so tests can swap in a fake. */
export type Db = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  /** Runs `work` on one connection inside a transaction: committed on success, rolled back on any error. */
  transaction: <T>(work: (db: Db) => Promise<T>) => Promise<T>;
};

export type SslMode = false | "verify" | "no-verify";

type MysqlConfig = {
  uri?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl: SslMode;
  /** CA certificate (PEM text, or a path to a PEM file) used to verify a self-signed server. */
  ca?: string;
};

function sslMode(value: string | undefined): SslMode {
  const mode = value?.trim().toLowerCase() ?? "";
  if (["1", "true", "yes", "verify"].includes(mode)) return "verify";
  if (["no-verify", "insecure", "skip-verify"].includes(mode)) return "no-verify";
  return false;
}

export function getMysqlConfig(env: Record<string, string | undefined> = process.env): MysqlConfig | null {
  const ssl = sslMode(env.MYSQL_SSL);
  const ca = env.MYSQL_SSL_CA?.trim();
  const tls = { ssl, ...(ca ? { ca } : {}) };

  const uri = env.MYSQL_URL?.trim();
  if (uri) return { uri, ...tls };

  const host = env.MYSQL_HOST?.trim();
  const user = env.MYSQL_USER?.trim();
  const database = env.MYSQL_DATABASE?.trim();
  if (!host || !user || !database) return null;
  const port = Number(env.MYSQL_PORT) || 3306;
  return { host, port, user, password: env.MYSQL_PASSWORD ?? "", database, ...tls };
}

export function isMysqlConfigured() {
  return getMysqlConfig() !== null;
}

const globalForPool = globalThis as unknown as { __costDb?: Promise<Db> };

async function tlsOptions(config: MysqlConfig) {
  if (!config.ssl && !config.ca) return {};
  if (config.ca) {
    // A pinned CA: the chain is verified against it. The hostname check is skipped because self-signed server
    // certificates are rarely issued for the IP address or host name used to connect.
    const pem = config.ca.includes("-----BEGIN") ? config.ca : (await import("node:fs")).readFileSync(config.ca, "utf8");
    return { ssl: { ca: pem, rejectUnauthorized: true, checkServerIdentity: () => undefined } };
  }
  return { ssl: { rejectUnauthorized: config.ssl !== "no-verify" } };
}

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
};

async function runQuery(target: Queryable, sql: string, params?: unknown[]): Promise<QueryResult> {
  const [result] = await target.query(sql, params);
  if (Array.isArray(result)) return { rows: result as Record<string, unknown>[], affectedRows: 0, insertId: 0 };
  const header = result as { affectedRows?: number; insertId?: number };
  return { rows: [], affectedRows: header.affectedRows ?? 0, insertId: header.insertId ?? 0 };
}

async function createDb(config: MysqlConfig): Promise<Db> {
  const mysql = await import("mysql2/promise");
  const common = {
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10_000,
    charset: "utf8mb4",
    // DATE/DECIMAL as plain strings/numbers: no timezone shifting of dates, no string amounts.
    dateStrings: true,
    decimalNumbers: true,
    ...(await tlsOptions(config)),
  };
  const pool = config.uri
    ? mysql.createPool({ uri: config.uri, ...common })
    : mysql.createPool({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, ...common });

  const db: Db = {
    query: (sql, params) => runQuery(pool, sql, params),
    async transaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const scoped: Db = { query: (sql, params) => runQuery(connection, sql, params), transaction: (inner) => inner(scoped) };
        const result = await work(scoped);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
  };
  return db;
}

/** Shared connection pool (kept across hot reloads). Throws a 503 CostDbError when MySQL is not configured. */
export function getDb(): Promise<Db> {
  const config = getMysqlConfig();
  if (!config) {
    throw new CostDbError("Chưa cấu hình MySQL. Điền MYSQL_URL (hoặc MYSQL_HOST/USER/PASSWORD/DATABASE) vào .env.local.", 503);
  }
  globalForPool.__costDb ??= createDb(config);
  return globalForPool.__costDb;
}

const TLS_CODES = [
  "HANDSHAKE_SSL_ERROR",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
];
const NETWORK_CODES = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "PROTOCOL_CONNECTION_LOST"];

/**
 * Translates driver errors into short messages a user can act on. Unknown errors keep their error code (never the
 * driver's message, which can contain host names or SQL) so a problem is never reduced to "something went wrong".
 */
export function toCostDbError(error: unknown): CostDbError {
  if (error instanceof CostDbError) return error;
  const { code, errno } = (error ?? {}) as { code?: string; errno?: number };
  if (code === "ER_NO_SUCH_TABLE" || errno === 1146) {
    return new CostDbError("Chưa có bảng cost_entries. Hãy chạy file database/schema.sql trên database này.", 503);
  }
  if (code === "ER_BAD_FIELD_ERROR" || errno === 1054 || code === "ER_WARN_DATA_TRUNCATED" || errno === 1265) {
    return new CostDbError("Bảng cost_entries chưa khớp phiên bản mới. Hãy chạy file database/migrations/2026-11-staff-work-days.sql trên database này.", 503);
  }
  if (code === "ER_ACCESS_DENIED_ERROR" || errno === 1045) return new CostDbError("MySQL từ chối tài khoản hoặc mật khẩu.", 503);
  if (code === "ER_DBACCESS_DENIED_ERROR" || errno === 1044) return new CostDbError("Tài khoản MySQL không có quyền trên database này.", 503);
  if (code === "ER_BAD_DB_ERROR" || errno === 1049) return new CostDbError("Database MySQL không tồn tại.", 503);
  if (code === "ER_CHECK_CONSTRAINT_VIOLATED" || errno === 3819 || errno === 4025) {
    return new CostDbError("Dữ liệu vi phạm ràng buộc của bảng cost_entries.", 400);
  }
  if (code && TLS_CODES.includes(code)) {
    return new CostDbError(
      `Không xác minh được chứng chỉ SSL của MySQL (${code}). Nếu server dùng chứng chỉ tự ký, đặt MYSQL_SSL_CA=<đường dẫn ca.pem> hoặc MYSQL_SSL=no-verify trong .env.local rồi khởi động lại server.`,
      503,
    );
  }
  if (code && NETWORK_CODES.includes(code)) return new CostDbError(`Không kết nối được tới MySQL (${code}).`, 503);
  console.error("cost db error", error);
  return new CostDbError(`Lỗi cơ sở dữ liệu${code ? ` (${code})` : ""}. Xem log máy chủ để biết chi tiết.`, 500);
}

/** Runs a repository operation on `db` (or the shared pool), translating driver failures into CostDbError. */
export async function withDb<T>(db: Db | undefined, work: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await work(db ?? (await getDb()));
  } catch (error) {
    throw toCostDbError(error);
  }
}
