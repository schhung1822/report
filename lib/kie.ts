import type { AiModelId } from "@/lib/ai-analysis";

// KIE_BASE_URL is only meant for pointing at a local mock when testing.
const KIE_BASE_URL = (process.env.KIE_BASE_URL?.trim() || "https://api.kie.ai").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 110_000;

export class KieError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type KieEnvelope = {
  code?: number;
  msg?: string;
  error?: { message?: string; type?: string };
  content?: { type?: string; text?: string }[];
  choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[];
};

function describeError(status: number, upstream: string): KieError {
  const detail = upstream ? ` (${upstream})` : "";
  switch (status) {
    case 401:
      return new KieError(`API key kie.ai không hợp lệ hoặc đã bị thu hồi${detail}.`, 502);
    case 402:
      return new KieError("Tài khoản kie.ai đã hết credits. Vui lòng nạp thêm.", 502);
    case 408:
      return new KieError("kie.ai phản hồi quá lâu. Vui lòng thử lại.", 504);
    case 429:
      return new KieError("kie.ai đang giới hạn tốc độ. Vui lòng thử lại sau ít phút.", 429);
    case 455:
      return new KieError("kie.ai đang bảo trì. Vui lòng thử lại sau.", 503);
    default:
      return new KieError(`Không nhận được kết quả từ kie.ai${detail}.`, 502);
  }
}

function buildRequest(model: AiModelId, system: string, user: string) {
  if (model === "claude-opus-4-7") {
    // The Claude endpoint documents no `system` field, so instructions go in the user turn.
    return {
      url: `${KIE_BASE_URL}/claude/v1/messages`,
      body: {
        model,
        messages: [{ role: "user", content: `${system}\n\n${user}` }],
        stream: false,
        max_tokens: 4096,
      },
    };
  }
  return {
    url: `${KIE_BASE_URL}/gpt-5-2/v1/chat/completions`,
    body: {
      messages: [
        { role: "developer", content: [{ type: "text", text: system }] },
        { role: "user", content: [{ type: "text", text: user }] },
      ],
      reasoning_effort: "low",
    },
  };
}

function extractText(model: AiModelId, json: KieEnvelope) {
  if (model === "claude-opus-4-7") {
    return (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

/** Calls kie.ai and returns the model's text. Throws KieError with a user-facing Vietnamese message. */
export async function runKie(model: AiModelId, system: string, user: string): Promise<string> {
  const apiKey = process.env.KIE_API_KEY?.trim();
  if (!apiKey) {
    throw new KieError("Chưa cấu hình KIE_API_KEY trong file .env.", 503);
  }

  const { url, body } = buildRequest(model, system, user);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new KieError("kie.ai phản hồi quá lâu. Vui lòng thử lại.", 504);
    }
    throw new KieError("Không kết nối được tới kie.ai. Kiểm tra mạng và thử lại.", 502);
  }

  let json: KieEnvelope | null = null;
  try {
    json = (await response.json()) as KieEnvelope;
  } catch {
    json = null;
  }

  // kie.ai can return HTTP 200 with an error code in the body, so check both.
  const bodyCode = typeof json?.code === "number" ? json.code : undefined;
  const upstreamMessage = json?.error?.message ?? json?.msg ?? "";
  if (!response.ok || (bodyCode !== undefined && bodyCode !== 200) || json?.error) {
    throw describeError(bodyCode && bodyCode !== 200 ? bodyCode : response.status, upstreamMessage);
  }

  const text = json ? extractText(model, json).trim() : "";
  if (!text) throw new KieError("Mô hình không trả về nội dung. Vui lòng thử lại.", 502);
  return text;
}
