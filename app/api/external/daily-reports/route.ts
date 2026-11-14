import { after } from "next/server";
import { rejectUnlessAuthorized } from "@/lib/external/auth";
import { ExternalJobError, runDailyReports } from "@/lib/external/daily-reports";
import { addDays, bucketUtcOffset, isValidIsoDate, todayAt } from "@/lib/pancake/dates";
import { MAX_RANGE_DAYS } from "@/lib/pancake/types";

// External API: creates the consolidated reports of a day and posts the Hiệu suất, Quản trị Việt and Quản trị Phil PDFs to Lark.
// It signs nobody in: callers prove themselves with EXTERNAL_API_KEY (proxy.ts lets /api/external/* through to here).

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// One run at a time: each run opens a Chrome, and two runs would post every report to the group twice.
let running = false;

type Params = { date?: unknown; from?: unknown; to?: unknown; async?: unknown };

async function handle(request: Request) {
  const rejected = rejectUnlessAuthorized(request);
  if (rejected) return rejected;

  // Parameters come from the JSON body, or from the query string for callers that cannot send a body.
  const query = new URL(request.url).searchParams;
  let body: Params = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as Params;
    } catch {
      return fail("Nội dung JSON không hợp lệ.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Nội dung JSON không hợp lệ.", 400);
  }
  const param = (name: keyof Params) => body[name] ?? query.get(name) ?? undefined;

  // `date` is one day; `from` + `to` a range. With none of them it is yesterday (the last day that is complete).
  const date = param("date");
  const rangeFrom = param("from");
  const rangeTo = param("to");
  let from: string;
  let to: string;
  if (date !== undefined) {
    if (!isValidIsoDate(date)) return fail("“date” không hợp lệ (cần dạng YYYY-MM-DD).", 400);
    from = to = date;
  } else if (rangeFrom !== undefined || rangeTo !== undefined) {
    if (!isValidIsoDate(rangeFrom) || !isValidIsoDate(rangeTo)) return fail("“from” và “to” phải đi cùng nhau, dạng YYYY-MM-DD.", 400);
    from = rangeFrom;
    to = rangeTo;
  } else {
    from = to = addDays(todayAt(bucketUtcOffset()), -1);
  }
  if (from > to) return fail("“from” phải trước hoặc bằng “to”.", 400);
  if (to > addDays(from, MAX_RANGE_DAYS - 1)) return fail(`Mỗi lần chỉ tạo tối đa ${MAX_RANGE_DAYS} ngày.`, 400);
  if (to > todayAt(bucketUtcOffset())) return fail("Không thể tạo báo cáo cho ngày trong tương lai.", 400);

  const background = param("async");
  if (background !== undefined && typeof background !== "boolean" && background !== "true" && background !== "false") {
    return fail("“async” phải là true hoặc false.", 400);
  }
  const runInBackground = background === true || background === "true";

  if (running) return fail("Một lần tạo báo cáo khác đang chạy. Vui lòng thử lại sau ít phút.", 409);
  running = true;

  if (runInBackground) {
    // Answer at once and finish the job after the response; the outcome is logged on the server.
    after(async () => {
      try {
        const result = await runDailyReports({ from, to });
        console.log("[external/daily-reports]", JSON.stringify(result));
      } catch (error) {
        console.error("[external/daily-reports]", error);
      } finally {
        running = false;
      }
    });
    return Response.json({ ok: true, accepted: true, range: { from, to }, message: "Đã nhận yêu cầu, báo cáo sẽ được gửi tới Lark khi tạo xong." }, { status: 202 });
  }

  try {
    const result = await runDailyReports({ from, to });
    const sent = result.reports.filter((report) => report.status === "sent").length;
    const failed = result.reports.filter((report) => report.status === "failed").length;
    // 200: all that could be made were sent. 207: some failed. 502: nothing was sent although something was due.
    const status = failed === 0 ? 200 : sent > 0 ? 207 : 502;
    return Response.json({ ok: failed === 0, sent, failed, ...result }, { status });
  } catch (error) {
    if (error instanceof ExternalJobError) return fail(error.message, error.status);
    console.error("[external/daily-reports]", error);
    return fail("Đã xảy ra lỗi khi tạo báo cáo. Vui lòng thử lại.", 500);
  } finally {
    running = false;
  }
}

/** Whatever goes wrong, the caller gets a JSON reason (a bare 500 with no body says nothing) and the server log gets the stack. */
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[external/daily-reports] unexpected", error);
    return fail(`Lỗi không mong muốn: ${error instanceof Error ? error.message : "không rõ"}`, 500);
  }
}
