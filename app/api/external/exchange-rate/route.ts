import { rejectUnlessAuthorized } from "@/lib/external/auth";
import { CostDbError, isMysqlConfigured } from "@/lib/costs/db";
import { bucketUtcOffset, todayAt } from "@/lib/pancake/dates";
import { latestRate, RATE_PAIR, validateRateInput } from "@/lib/rates/rates";
import { listRates, upsertRate } from "@/lib/rates/repository";

// External API for the house exchange rate (1 PHP = ? VND), so another system can keep it up to date.
// It writes the same table as the "Tỷ giá" page. Callers prove themselves with EXTERNAL_API_KEY (see lib/external/auth.ts).

const HISTORY_SHOWN = 10;
const API_NOTE = "Cập nhật qua API";

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function requireDatabase() {
  return isMysqlConfigured() ? null : fail("Chưa cấu hình MySQL nên không lưu được tỷ giá.", 503);
}

/** The rate in force today and the latest entries of the history. */
export async function GET(request: Request) {
  const rejected = rejectUnlessAuthorized(request);
  if (rejected) return rejected;
  const noDatabase = requireDatabase();
  if (noDatabase) return noDatabase;

  try {
    const history = await listRates(RATE_PAIR.from, RATE_PAIR.to);
    const today = todayAt(bucketUtcOffset());
    return Response.json({
      pair: `${RATE_PAIR.from}-${RATE_PAIR.to}`,
      today,
      current: latestRate(history, today),
      history: history.slice(0, HISTORY_SHOWN),
    });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    return fail("Không thể đọc danh sách tỷ giá.", 500);
  }
}

/**
 * Sets the rate: `{ "rate": 450.5, "effectiveDate": "2026-11-10", "note": "..." }`. `effectiveDate` is the first day the rate
 * applies (default today, UTC+7) and `note` is optional. Sending the same effective date again changes that day's rate.
 * Reports convert every day they show with the newest rate already in effect, so reports built afterwards use it.
 */
export async function POST(request: Request) {
  const rejected = rejectUnlessAuthorized(request);
  if (rejected) return rejected;
  const noDatabase = requireDatabase();
  if (noDatabase) return noDatabase;

  // The values come from the JSON body, or from the query string for callers that cannot send a body.
  let body: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Nội dung JSON không hợp lệ.", 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return fail("Nội dung JSON không hợp lệ.", 400);
    }
  }
  const query = new URL(request.url).searchParams;
  const pick = (name: string) => body[name] ?? query.get(name) ?? undefined;

  if (pick("rate") === undefined || pick("rate") === "") return fail("Thiếu “rate” (số VND cho 1 PHP).", 400);
  const parsed = validateRateInput({
    fromCurrency: pick("fromCurrency"),
    toCurrency: pick("toCurrency"),
    rate: pick("rate"),
    effectiveDate: pick("effectiveDate") ?? pick("date") ?? todayAt(bucketUtcOffset()),
    note: pick("note") ?? API_NOTE,
  });
  if (!parsed.ok) return fail(parsed.error, 400);

  try {
    const rate = await upsertRate(parsed.value, "api");
    return Response.json({ ok: true, rate });
  } catch (error) {
    if (error instanceof CostDbError) return fail(error.message, error.status);
    console.error("[external/exchange-rate]", error);
    return fail("Không thể lưu tỷ giá.", 500);
  }
}
