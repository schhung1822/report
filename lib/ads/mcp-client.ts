/**
 * Minimal MCP (Streamable HTTP) client for the Ads MCP (mcp.activate.vn). Server-side only.
 *
 * The whole endpoint address, token included, is the secret: it comes from ADS_MCP_URL and must never reach the
 * browser, a log line or an error message.
 */
import { describeNetworkError, parseRpcBody } from "@/lib/pancake/mcp-client";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 60_000;

export class AdsError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "AdsError";
  }
}

export function isAdsConfigured() {
  return Boolean(process.env.ADS_MCP_URL?.trim());
}

function getAdsUrl() {
  const url = process.env.ADS_MCP_URL?.trim();
  if (!url) throw new AdsError("Chưa cấu hình ADS_MCP_URL. Thêm địa chỉ Ads MCP vào .env.local rồi khởi động lại server.", 503);
  return url;
}

type ToolResult = {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
};

/** The JSON of a tool result: structured content when the server gives it, else the first JSON object in the text. */
function parseToolPayload(result: ToolResult): unknown {
  const text = (result.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
  if (result.isError) throw new AdsError(text.slice(0, 400) || "Ads MCP trả về lỗi.", 502);
  if (result.structuredContent !== undefined) return result.structuredContent;
  const start = text.indexOf("{");
  try {
    return JSON.parse(start >= 0 ? text.slice(start) : text);
  } catch {
    throw new AdsError("Không đọc được dữ liệu trả về từ Ads MCP.", 502);
  }
}

export class AdsSession {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;

  private constructor(private readonly url: string) {}

  /** Opens a session (initialize handshake). Reuse it for a whole report. */
  static async open() {
    const session = new AdsSession(getAdsUrl());
    await session.initialize();
    return session;
  }

  private async post(payload: object, id?: number) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
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
      throw new AdsError(`Không kết nối được tới Ads MCP (${describeNetworkError(error)}).`, 504);
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new AdsError("Ads MCP từ chối địa chỉ kết nối. Kiểm tra lại ADS_MCP_URL (token có thể đã hết hạn hoặc bị thu hồi).", 502);
    }
    if (!response.ok) throw new AdsError(`Ads MCP trả về HTTP ${response.status}.`, 502);

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (id === undefined) return null;

    const message = parseRpcBody(await response.text(), response.headers.get("content-type") ?? "", id);
    if (!message) throw new AdsError("Ads MCP không trả về kết quả.", 502);
    if (message.error) throw new AdsError(`Ads MCP: ${message.error.message}`, 502);
    return message.result;
  }

  private async initialize() {
    const id = this.nextId++;
    const result = (await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "baocao", version: "0.1.0" } },
      },
      id,
    )) as { protocolVersion?: string } | null;
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  /** Calls an `ads_*` / `meta_*` tool and returns its parsed JSON payload. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const result = (await this.post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, id)) as ToolResult;
    return parseToolPayload(result) as T;
  }
}
