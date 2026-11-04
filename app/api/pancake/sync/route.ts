import { getSessionUser } from "@/lib/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { saveSnapshot } from "@/lib/history/repository";
import { addDays, isValidIsoDate } from "@/lib/pancake/dates";
import { PancakeError } from "@/lib/pancake/mcp-client";
import { syncFromPancake } from "@/lib/pancake/sync";
import { MAX_RANGE_DAYS, type ManualCostRow } from "@/lib/pancake/types";

const MAX_COST_ROWS = 2_000;
const AMOUNT_FIELDS = ["salarySaleCskh", "salaryOther", "fixedCost", "otherCost", "adsCost", "returnProvision"] as const;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Validates the cost lines sent by the browser. Returns null when anything is malformed. */
function parseCosts(value: unknown): ManualCostRow[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_COST_ROWS) return null;

  const rows: ManualCostRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    if (raw.date !== undefined && !isValidIsoDate(raw.date)) return null;
    if (raw.channel !== undefined && raw.channel !== "zalo" && raw.channel !== "page") return null;
    if (raw.staff !== undefined && (typeof raw.staff !== "string" || raw.staff.length > 120)) return null;
    if (raw.exchangeRate !== undefined && !(typeof raw.exchangeRate === "number" && raw.exchangeRate > 0)) return null;

    const row: ManualCostRow = {
      date: raw.date as string | undefined,
      channel: raw.channel as ManualCostRow["channel"],
      staff: raw.staff as string | undefined,
      exchangeRate: raw.exchangeRate as number | undefined,
      salarySaleCskh: 0,
      salaryOther: 0,
      fixedCost: 0,
      otherCost: 0,
      adsCost: 0,
      returnProvision: 0,
    };
    for (const field of AMOUNT_FIELDS) {
      const amount = raw[field] ?? 0;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
      row[field] = amount;
    }
    rows.push(row);
  }
  return rows;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Phiên đăng nhập đã hết hạn.", 401);

  let payload: { from?: unknown; to?: unknown; shopId?: unknown; costs?: unknown; useMetaAds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return fail("Yêu cầu không hợp lệ.", 400);
  }

  if (!isValidIsoDate(payload.from) || !isValidIsoDate(payload.to)) {
    return fail("Ngày báo cáo không hợp lệ (cần dạng YYYY-MM-DD).", 400);
  }
  if (payload.from > payload.to) return fail("“Từ ngày” phải trước hoặc bằng “Đến ngày”.", 400);
  if (payload.to > addDays(payload.from, MAX_RANGE_DAYS - 1)) {
    return fail(`Mỗi lần chỉ lấy tối đa ${MAX_RANGE_DAYS} ngày.`, 400);
  }
  const shopId = payload.shopId === undefined || payload.shopId === null ? undefined : Number(payload.shopId);
  if (shopId !== undefined && !Number.isSafeInteger(shopId)) return fail("Mã shop không hợp lệ.", 400);
  const costs = parseCosts(payload.costs);
  if (!costs) return fail("File chi phí không hợp lệ.", 400);
  if (payload.useMetaAds !== undefined && typeof payload.useMetaAds !== "boolean") return fail("Tuỳ chọn Ads Meta không hợp lệ.", 400);

  try {
    const result = await syncFromPancake({ from: payload.from, to: payload.to, shopId, costs, useMetaAds: payload.useMetaAds });

    // Keep the report so it survives a reload. A failure here must not lose the report the user just asked for.
    if (isMysqlConfigured()) {
      try {
        const saved = await saveSnapshot(result, user);
        result.snapshot = { id: saved.id, createdAt: saved.createdAt, restored: false };
      } catch (error) {
        const reason = error instanceof CostDbError ? error.message : "lỗi không xác định";
        result.warnings = [...result.warnings, `Không lưu được vào lịch sử báo cáo: ${reason}`];
      }
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof PancakeError) return fail(error.message, error.status);
    if (error instanceof CostDbError) return fail(`Không đọc được chi phí từ MySQL: ${error.message}`, error.status);
    return fail("Không thể đồng bộ dữ liệu từ Pancake POS. Vui lòng thử lại.", 500);
  }
}
