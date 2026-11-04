/**
 * Turns the Meta ad spend of one market's labelled accounts into cost lines for that market's reports.
 *
 *  - Philippines: the spend (VND) of the accounts labelled PH becomes shop-wide ads cost in pesos, converted with each
 *    day's rate (the rate typed for that day, else the latest stored one).
 *  - Vietnam: the spend of the accounts labelled VN with a channel (Zalo / Page) becomes that channel's ads cost, in
 *    dong, and the spend of the accounts without a channel becomes shop-wide ads cost. The management report covers the
 *    whole shop, so both end up in it.
 *
 * A day (and channel) that already has an ads cost typed in (file or MySQL) keeps it, so nothing is counted twice.
 */
import type { AccountSpend, MetaSpend } from "@/lib/ads/report";
import { latestRate, type ExchangeRateEntry } from "@/lib/rates/rates";
import { costsForAnyScope, costsFor, exchangeRateFor } from "./costs";
import { round2 } from "./dataset";
import { toDmy } from "./dates";
import type { ManagementChannel, ManualCostRow, MetaAdsSummary } from "./types";

const money = new Intl.NumberFormat("vi-VN");
const lineOf = (date: string, adsCost: number, channel?: ManagementChannel): ManualCostRow => ({
  date,
  channel,
  salarySaleCskh: 0,
  salaryOther: 0,
  fixedCost: 0,
  otherCost: 0,
  adsCost,
  returnProvision: 0,
});

/** Spend of all the accounts together, per day (the accounts of one channel when `channel` is given). */
function spendPerDay(accounts: AccountSpend[], channel?: AccountSpend["channel"] | "any") {
  const perDay = new Map<string, number>();
  for (const account of accounts) {
    if (channel !== undefined && channel !== "any" && account.channel !== channel) continue;
    for (const [date, spend] of account.spendByDate) perDay.set(date, (perDay.get(date) ?? 0) + spend);
  }
  return perDay;
}

export type MetaAdsApplication = { lines: ManualCostRow[]; summary: MetaAdsSummary; warnings: string[] };

export function applyMetaAds(input: {
  market: "VN" | "PH";
  spend: MetaSpend;
  costs: ManualCostRow[];
  /** Philippines only: the stored rate history (null = no database) and today's date for "in effect". */
  rates: ExchangeRateEntry[] | null;
  today: string;
}): MetaAdsApplication {
  const { market, spend, costs } = input;
  const warnings = [...spend.warnings];
  const lines: ManualCostRow[] = [];
  const total = spendPerDay(spend.accounts, "any");
  const channelTotals = { zalo: 0, page: 0, unassigned: 0 };
  for (const account of spend.accounts) {
    const sum = Array.from(account.spendByDate.values()).reduce((a, b) => a + b, 0);
    channelTotals[account.channel ?? "unassigned"] += sum;
  }
  let applied = 0;

  if (market === "PH") {
    const latest = input.rates ? latestRate(input.rates, input.today) : null;
    const manualDays: string[] = [];
    const noRateDays: string[] = [];
    for (const [date, vnd] of Array.from(total).sort(([a], [b]) => a.localeCompare(b))) {
      if (vnd <= 0) continue;
      if (costsFor(costs, date, { kind: "shop" }).adsCost > 0) {
        manualDays.push(date);
        continue;
      }
      const rate = exchangeRateFor(costs, date) ?? latest?.rate;
      if (!rate) {
        noRateDays.push(date);
        continue;
      }
      lines.push(lineOf(date, round2(vnd / rate)));
      applied += vnd;
    }
    if (spend.accounts.length) {
      warnings.push(
        `Chi phí Ads Meta (shop Phil): ${money.format(Math.round(applied))} ₫ từ ${spend.accounts.length} tài khoản gắn nhãn PH, áp dụng cho ${lines.length} ngày (VND chia tỷ giá của ngày ra peso).`,
      );
    }
    if (manualDays.length) warnings.push(`${manualDays.length} ngày đã có chi phí ads nhập tay nên giữ số nhập tay, không cộng thêm Ads Meta.`);
    if (noRateDays.length) {
      warnings.push(
        `⚠ ${noRateDays.length} ngày có Ads Meta nhưng chưa có tỷ giá để đổi sang peso nên chưa tính (nhập ở trang Tỷ giá): ${noRateDays.slice(0, 5).map(toDmy).join(", ")}${noRateDays.length > 5 ? "…" : ""}.`,
      );
    }
  } else {
    const manual: string[] = [];
    for (const channel of ["zalo", "page"] as const) {
      let channelApplied = 0;
      for (const [date, vnd] of Array.from(spendPerDay(spend.accounts, channel)).sort(([a], [b]) => a.localeCompare(b))) {
        if (vnd <= 0) continue;
        if (costsFor(costs, date, { kind: "channel", channel }).adsCost > 0) {
          manual.push(`${channel === "zalo" ? "Zalo" : "Page"} ${toDmy(date)}`);
          continue;
        }
        lines.push(lineOf(date, round2(vnd), channel));
        channelApplied += vnd;
      }
      applied += channelApplied;
      if (spend.accounts.some((account) => account.channel === channel)) {
        warnings.push(`Chi phí Ads Meta kênh ${channel === "zalo" ? "Zalo" : "Page"}: ${money.format(Math.round(channelApplied))} ₫ (tài khoản gắn nhãn VN · ${channel === "zalo" ? "Zalo" : "Page"}).`);
      }
    }
    // The management report covers the whole shop, so the accounts with no channel chosen count too, as shop-wide ads cost.
    let unassignedApplied = 0;
    for (const [date, vnd] of Array.from(spendPerDay(spend.accounts, null)).sort(([a], [b]) => a.localeCompare(b))) {
      if (vnd <= 0) continue;
      if (costsForAnyScope(costs, date).adsCost > 0) {
        manual.push(`Chưa chọn kênh ${toDmy(date)}`);
        continue;
      }
      lines.push(lineOf(date, round2(vnd)));
      unassignedApplied += vnd;
    }
    applied += unassignedApplied;
    if (channelTotals.unassigned > 0) {
      warnings.push(`Chi phí Ads Meta tài khoản gắn nhãn VN chưa chọn kênh: ${money.format(Math.round(unassignedApplied))} ₫, tính vào chi phí ads chung của shop.`);
    }
    if (manual.length) warnings.push(`${manual.length} ngày/kênh đã có chi phí ads nhập tay nên giữ số nhập tay: ${manual.slice(0, 4).join(", ")}${manual.length > 4 ? "…" : ""}.`);
  }

  const summary: MetaAdsSummary = {
    market,
    currency: "VND",
    accounts: spend.accounts.map((account) => ({ id: account.accountId, name: account.name, channel: account.channel })),
    totalSpend: round2(Array.from(total.values()).reduce((a, b) => a + b, 0)),
    days: Array.from(total, ([date, value]) => ({ date, spend: round2(value) })).sort((a, b) => a.date.localeCompare(b.date)),
    byChannel: { zalo: round2(channelTotals.zalo), page: round2(channelTotals.page), unassigned: round2(channelTotals.unassigned) },
    appliedSpend: round2(applied),
  };
  return { lines, summary, warnings };
}
