import { analyzeWithFallback } from "@/lib/ai-run";
import {
  AI_MODELS,
  buildUserPrompt,
  MAX_DATA_LENGTH,
  MAX_FOCUS_LENGTH,
  parseAnalysis,
  REPORT_TYPES,
  SYSTEM_PROMPT,
  type AiModelId,
  type AnalyzeResponse,
  type ReportType,
} from "@/lib/ai-analysis";
import { getSessionUser } from "@/lib/auth";
import { KieError } from "@/lib/kie";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { model?: unknown; reportType?: unknown; data?: unknown; focus?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  const model = AI_MODELS.find((item) => item.id === payload.model)?.id as AiModelId | undefined;
  const reportType = typeof payload.reportType === "string" && payload.reportType in REPORT_TYPES ? (payload.reportType as ReportType) : undefined;
  const data = typeof payload.data === "string" ? payload.data : "";
  const focus = typeof payload.focus === "string" ? payload.focus.trim() : "";

  if (!model || !reportType) return fail("Mô hình hoặc loại báo cáo không hợp lệ.", 400);
  if (!data.trim()) return fail("Chưa có dữ liệu báo cáo để phân tích.", 400);
  if (data.length > MAX_DATA_LENGTH) return fail("Dữ liệu báo cáo quá lớn để phân tích.", 413);
  if (focus.length > MAX_FOCUS_LENGTH) return fail(`Phần yêu cầu bổ sung tối đa ${MAX_FOCUS_LENGTH} ký tự.`, 400);

  try {
    const used = await analyzeWithFallback(model, SYSTEM_PROMPT, buildUserPrompt(reportType, data, focus));
    const body: AnalyzeResponse = { model: used.model, analysis: parseAnalysis(used.raw), raw: used.raw, ...(used.fallbackFrom ? { fallbackFrom: used.fallbackFrom } : {}) };
    return Response.json(body);
  } catch (error) {
    if (error instanceof KieError) return fail(error.message, error.status);
    return fail("Đã xảy ra lỗi khi phân tích. Vui lòng thử lại.", 500);
  }
}
