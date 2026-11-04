import type { AdsAdditive, AdsMetrics, AdsRatios } from "./types";

const ADDITIVE_KEYS = [
  "spend",
  "impressions",
  "clicks",
  "linkClicks",
  "conversions",
  "conversionValue",
  "purchases",
  "leads",
  "messages",
  "videoViews",
] as const satisfies readonly (keyof AdsAdditive)[];

/** The metric names the MCP uses for each additive figure, in the same order as ADDITIVE_KEYS. */
export const MCP_METRIC_NAMES = [
  "spend",
  "impressions",
  "clicks",
  "link_clicks",
  "conversions",
  "conversion_value",
  "purchases",
  "leads",
  "messages",
  "video_views",
] as const;

export function zeroAdditive(): AdsAdditive {
  return { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, conversions: 0, conversionValue: 0, purchases: 0, leads: 0, messages: 0, videoViews: 0 };
}

export function addAdditive(a: AdsAdditive, b: AdsAdditive): AdsAdditive {
  const total = zeroAdditive();
  for (const key of ADDITIVE_KEYS) total[key] = a[key] + b[key];
  return total;
}

export function sumAdditive(items: AdsAdditive[]): AdsAdditive {
  return items.reduce(addAdditive, zeroAdditive());
}

const ratio = (numerator: number, denominator: number, scale = 1) => (denominator > 0 ? (numerator / denominator) * scale : null);

/** CTR, CPC, CPM, CPA, ROAS … from sums. A ratio with nothing to divide by is null, never 0 or infinite. */
export function deriveRatios(sum: AdsAdditive): AdsRatios {
  return {
    ctr: ratio(sum.clicks, sum.impressions, 100),
    cpc: ratio(sum.spend, sum.clicks),
    cpm: ratio(sum.spend, sum.impressions, 1000),
    cpa: ratio(sum.spend, sum.conversions),
    roas: ratio(sum.conversionValue, sum.spend),
    costPerPurchase: ratio(sum.spend, sum.purchases),
    costPerMessage: ratio(sum.spend, sum.messages),
  };
}

export function toMetrics(sum: AdsAdditive): AdsMetrics {
  return { ...sum, ...deriveRatios(sum) };
}

/** A figure from the MCP: a finite number, or 0 when it is missing/null (the MCP uses null for "not on this platform"). */
function figure(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Reads the `metrics` object of one MCP report row. */
export function additiveFromMcp(metrics: Record<string, unknown> | null | undefined): AdsAdditive {
  const source = metrics ?? {};
  const result = zeroAdditive();
  ADDITIVE_KEYS.forEach((key, index) => {
    result[key] = figure(source[MCP_METRIC_NAMES[index]]);
  });
  return result;
}
