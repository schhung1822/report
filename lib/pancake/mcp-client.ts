/**
 * Minimal MCP (Streamable HTTP) client for Pancake POS. Server-side only: the API key comes from
 * PANCAKE_POS_API_KEY and must never reach the browser.
 *
 * Docs: https://pos.pancake.vn/developers/mcp/connect
 */

const DEFAULT_MCP_URL = "https://mcp-pos.pancake.biz/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 30_000;

export class PancakeError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "PancakeError";
  }
}

type JsonRpcResponse = {
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

type ToolResult = {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
};

/** Every PANCAKE_POS_API_KEY / PANCAKE_POS_API_KEY_<SUFFIX> variable that is set (one key per shop, or one account key). */
export function getPancakeKeys() {
  return Object.entries(process.env)
    .filter(([name, value]) => /^PANCAKE_POS_API_KEY(_[A-Z0-9_]+)?$/.test(name) && value?.trim())
    .map(([name, value]) => ({ name, apiKey: (value as string).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPancakeConfig() {
  const keys = getPancakeKeys();
  if (!keys.length) {
    throw new PancakeError(
      "Chưa cấu hình PANCAKE_POS_API_KEY. Thêm API key Pancake POS vào .env.local rồi khởi động lại server.",
      503,
    );
  }
  return { keys, url: process.env.PANCAKE_POS_MCP_URL?.trim() || DEFAULT_MCP_URL };
}

/** Short, user-facing reason for a failed fetch (DNS, refused, timeout...). */
export function describeNetworkError(error: unknown) {
  if (error instanceof Error && error.name === "TimeoutError") return "hết thời gian chờ";
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  if (cause?.code === "ENOTFOUND" || cause?.code === "EAI_AGAIN") return "không phân giải được tên miền";
  if (cause?.code === "ECONNREFUSED") return "bị từ chối kết nối";
  return cause?.code ?? "lỗi mạng";
}

/** Extracts the JSON-RPC message with the given id from a plain JSON or text/event-stream body. */
export function parseRpcBody(body: string, contentType: string, id: number): JsonRpcResponse | null {
  if (!body.trim()) return null;
  if (!contentType.includes("text/event-stream")) return JSON.parse(body) as JsonRpcResponse;

  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    const message = JSON.parse(data) as JsonRpcResponse;
    if (message.id === id) return message;
  }
  return null;
}

/** Tool output is a text block, sometimes prefixed with "HTTP 200 OK\n---\n" before the JSON payload. */
function parseToolPayload(result: ToolResult): unknown {
  const text = (result.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");

  if (result.isError) throw new PancakeError(text || "Pancake POS trả về lỗi.", 502);
  if (result.structuredContent !== undefined) return result.structuredContent;

  const separator = text.indexOf("\n---\n");
  const json = (separator >= 0 ? text.slice(separator + 5) : text).trim();
  try {
    return JSON.parse(json);
  } catch {
    throw new PancakeError("Không đọc được dữ liệu trả về từ Pancake POS.", 502);
  }
}

export class PancakeSession {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;

  private constructor(
    private readonly url: string,
    private readonly apiKey: string,
  ) {}

  /** Opens a session (initialize handshake) with the given key, or the first configured one. Reuse it for a whole sync. */
  static async open(apiKey?: string) {
    const config = getPancakeConfig();
    const session = new PancakeSession(config.url, apiKey ?? config.keys[0].apiKey);
    await session.initialize();
    return session;
  }

  private async post(payload: object, id?: number) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Api-Key": this.apiKey,
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PancakeError(`Không kết nối được tới Pancake POS MCP (${describeNetworkError(error)}).`, 504);
    }

    if (response.status === 401 || response.status === 403) {
      throw new PancakeError("Pancake POS từ chối API key. Kiểm tra lại PANCAKE_POS_API_KEY và quyền của key.", 502);
    }
    if (!response.ok) throw new PancakeError(`Pancake POS MCP trả về HTTP ${response.status}.`, 502);

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (id === undefined) return null;

    const message = parseRpcBody(await response.text(), response.headers.get("content-type") ?? "", id);
    if (!message) throw new PancakeError("Pancake POS MCP không trả về kết quả.", 502);
    if (message.error) throw new PancakeError(`Pancake POS: ${message.error.message}`, 502);
    return message.result;
  }

  private async initialize() {
    const id = this.nextId++;
    const result = (await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "baocao", version: "0.1.0" },
        },
      },
      id,
    )) as { protocolVersion?: string } | null;
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Calls a `pos_*` tool and returns its parsed JSON payload. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const result = (await this.post(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
      id,
    )) as ToolResult;
    return parseToolPayload(result) as T;
  }
}
