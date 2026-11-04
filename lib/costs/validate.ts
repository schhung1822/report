import { isValidIsoDate } from "../pancake/dates";
import {
  CHANNELS,
  COST_PERIODS,
  COST_SCOPES,
  COST_TYPES,
  MAX_WORK_DAYS,
  type CostChannel,
  type CostEntryInput,
  type CostPeriod,
  type CostScopeKind,
  type CostType,
} from "./types";

export const MAX_AMOUNT = 1e13;

type Validation = { ok: true; value: CostEntryInput } | { ok: false; error: string };

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function text(value: unknown, max: number) {
  if (value === undefined || value === null) return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const };
  const trimmed = value.trim();
  return trimmed.length > max ? { ok: false as const } : { ok: true as const, value: trimmed || null };
}

/** Validates and normalizes one entry sent by the browser. The same rules are enforced again by CHECKs in MySQL. */
export function validateCostEntryInput(raw: unknown): Validation {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Dữ liệu không hợp lệ." };
  const input = raw as Record<string, unknown>;

  const shopId = Number(input.shopId);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return { ok: false, error: "Mã shop không hợp lệ." };
  if (!oneOf<CostScopeKind>(COST_SCOPES, input.scope)) return { ok: false, error: "Phạm vi không hợp lệ." };
  if (!oneOf<CostType>(COST_TYPES, input.costType)) return { ok: false, error: "Loại chi phí không hợp lệ." };
  if (!oneOf<CostPeriod>(COST_PERIODS, input.period)) return { ok: false, error: "Chu kỳ không hợp lệ." };

  let channel: CostChannel | null = null;
  let staffName: string | null = null;
  if (input.scope === "channel") {
    if (!oneOf<CostChannel>(CHANNELS, input.channel)) return { ok: false, error: "Hãy chọn kênh Zalo hoặc Page." };
    channel = input.channel;
  } else if (input.scope === "staff") {
    const staff = text(input.staffName, 120);
    if (!staff.ok || !staff.value) return { ok: false, error: "Hãy nhập tên nhân sự (tối đa 120 ký tự)." };
    staffName = staff.value;
  }

  const label = text(input.label, 160);
  if (!label.ok) return { ok: false, error: "Tên khoản tối đa 160 ký tự." };
  const note = text(input.note, 255);
  if (!note.ok) return { ok: false, error: "Ghi chú tối đa 255 ký tự." };

  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) {
    return { ok: false, error: "Số tiền phải là số từ 0 trở lên." };
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    return { ok: false, error: "Số tiền chỉ được có tối đa 2 chữ số thập phân." };
  }

  if (!isValidIsoDate(input.validFrom)) return { ok: false, error: "Ngày bắt đầu không hợp lệ." };
  const rawTo = input.validTo === "" ? null : input.validTo;
  if (rawTo !== null && rawTo !== undefined && !isValidIsoDate(rawTo)) return { ok: false, error: "Ngày kết thúc không hợp lệ." };
  let validTo: string | null = (rawTo as string | null | undefined) ?? null;
  if (validTo !== null && validTo < input.validFrom) return { ok: false, error: "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu." };
  if (input.period === "once") validTo = input.validFrom;

  const workDays = parseWorkDays(input.workDays);
  if (!workDays.ok) return { ok: false, error: workDays.error };
  if (workDays.value !== null && (input.scope !== "staff" || input.period !== "monthly")) {
    return { ok: false, error: "Số công chuẩn chỉ dùng cho khoản hằng tháng của nhân sự." };
  }

  return {
    ok: true,
    value: {
      shopId,
      scope: input.scope,
      channel,
      staffName,
      costType: input.costType,
      label: label.value ?? "",
      amount: Math.round(amount * 100) / 100,
      period: input.period,
      validFrom: input.validFrom,
      validTo,
      note: note.value,
      workDays: workDays.value,
    },
  };
}

/** "Số công chuẩn": empty means none, otherwise a whole number of days from 1 to a month's longest. */
export function parseWorkDays(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  const days = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_WORK_DAYS) {
    return { ok: false, error: `Số công chuẩn phải là số ngày nguyên từ 1 đến ${MAX_WORK_DAYS}.` };
  }
  return { ok: true, value: days };
}
