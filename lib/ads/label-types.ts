/**
 * Which shop each Meta ad account runs for: the types and the validation, safe for the browser too (the MySQL access is in labels.ts). The labels are what
 * lets a report pick the right ad spend by itself: the Philippines report takes the accounts labelled PH, the Vietnam
 * reports those labelled VN (by channel, when the label names one).
 */

export type AdsMarket = "VN" | "PH";
export type AdsChannel = "zalo" | "page";

export type AdsAccountLabel = {
  accountId: string;
  market: AdsMarket;
  /** Vietnam only: the sales channel the account's ads feed. null = not split by channel. */
  channel: AdsChannel | null;
};

export const MARKETS: AdsMarket[] = ["VN", "PH"];
export const MARKET_LABEL: Record<AdsMarket, string> = { VN: "Shop Việt", PH: "Shop Phil" };
export const CHANNEL_LABEL: Record<AdsChannel, string> = { zalo: "Zalo", page: "Page" };

const ACCOUNT_ID = /^act_\d{1,30}$/;
const MAX_LABELS = 200;

type Validation = { ok: true; value: AdsAccountLabel[] } | { ok: false; error: string };

/** Checks the labels sent by the browser. Each account may carry at most one label per market. */
export function validateLabels(payload: unknown): Validation {
  if (!Array.isArray(payload)) return { ok: false, error: "Danh sách nhãn không hợp lệ." };
  if (payload.length > MAX_LABELS) return { ok: false, error: `Tối đa ${MAX_LABELS} nhãn.` };

  const seen = new Set<string>();
  const labels: AdsAccountLabel[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") return { ok: false, error: "Nhãn không hợp lệ." };
    const raw = item as Record<string, unknown>;
    if (typeof raw.accountId !== "string" || !ACCOUNT_ID.test(raw.accountId)) return { ok: false, error: "Mã tài khoản quảng cáo không hợp lệ." };
    if (raw.market !== "VN" && raw.market !== "PH") return { ok: false, error: "Nhãn phải là shop Việt (VN) hoặc shop Phil (PH)." };
    const channel = raw.channel ?? null;
    if (channel !== null && channel !== "zalo" && channel !== "page") return { ok: false, error: "Kênh phải là Zalo hoặc Page." };
    if (channel !== null && raw.market !== "VN") return { ok: false, error: "Chỉ nhãn shop Việt mới có kênh Zalo/Page." };
    const key = `${raw.accountId}|${raw.market}`;
    if (seen.has(key)) return { ok: false, error: `Tài khoản ${raw.accountId} bị gắn nhãn ${raw.market} hai lần.` };
    seen.add(key);
    labels.push({ accountId: raw.accountId, market: raw.market, channel });
  }
  return { ok: true, value: labels };
}

/** The labels of one market (what a report of that market reads). */
export const labelsOf = (labels: AdsAccountLabel[], market: AdsMarket) => labels.filter((label) => label.market === market);
