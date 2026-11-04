export const COST_TYPES = [
  "salary_sale_cskh",
  "salary_other",
  "bonus",
  "fixed_cost",
  "other_cost",
  "ads_cost",
  "return_provision",
] as const;
export type CostType = (typeof COST_TYPES)[number];

export const COST_TYPE_LABELS: Record<CostType, string> = {
  salary_sale_cskh: "Lương CSKH-Sale",
  salary_other: "Lương bộ phận khác",
  bonus: "Thưởng nhân sự",
  fixed_cost: "Định phí (chi phí cố định)",
  other_cost: "Chi phí khác",
  ads_cost: "Chi phí marketing (ads)",
  return_provision: "Dự phòng hoàn",
};

export const COST_PERIODS = ["daily", "monthly", "once"] as const;
export type CostPeriod = (typeof COST_PERIODS)[number];

export const COST_PERIOD_LABELS: Record<CostPeriod, string> = {
  daily: "Hằng ngày",
  monthly: "Hằng tháng (chia đều theo ngày)",
  once: "Một lần",
};

export const COST_SCOPES = ["shop", "channel", "staff"] as const;
export type CostScopeKind = (typeof COST_SCOPES)[number];

export const COST_SCOPE_LABELS: Record<CostScopeKind, string> = {
  shop: "Cả shop",
  channel: "Theo kênh",
  staff: "Theo nhân sự",
};

export const CHANNELS = ["zalo", "page"] as const;
export type CostChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<CostChannel, string> = { zalo: "Zalo", page: "Page" };

/** What the form / API sends. `validTo` is null for an open-ended entry. */
export type CostEntryInput = {
  shopId: number;
  scope: CostScopeKind;
  channel: CostChannel | null;
  staffName: string | null;
  costType: CostType;
  label: string;
  amount: number;
  period: CostPeriod;
  /** "YYYY-MM-DD" */
  validFrom: string;
  validTo: string | null;
  note: string | null;
  /**
   * Standard working days of the month. Only for a monthly amount of a staff member: the amount is then a monthly pay that
   * costs `amount / workDays` for each day the staff member worked (had orders), and nothing on the days off. Null = the
   * amount is spread over every calendar day.
   */
  workDays: number | null;
};

/** The largest "số công chuẩn" a month can have. */
export const MAX_WORK_DAYS = 31;

/** A stored row (see database/schema.sql). */
export type CostEntry = CostEntryInput & {
  id: number;
  createdBy: string | null;
  updatedAt: string | null;
};
