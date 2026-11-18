/** File-name prefix of each report, as it is saved and as it arrives in Lark. */
export const REPORT_FILE_PREFIX = {
  daily: "bao-cao-thu-chi",
  performance: "bao-cao-hieu-suat",
  vn: "bao-cao-viet",
  ph: "bao-cao-phil",
} as const;

export type ReportFileKey = keyof typeof REPORT_FILE_PREFIX;

/**
 * The date part of a file name, from the report's own date label: "29/10/2026" -> "29-10-2026" and a range
 * "01/11/2026 – 05/11/2026" -> "01-11-2026_05-11-2026". A label with no date in it falls back to today.
 * Reads the clock: call it from event handlers, not while rendering.
 */
export function reportFileDate(label?: string | null) {
  const dates = (label ?? "").match(/\d{1,2}\/\d{1,2}(?:\/\d{4})?/g);
  if (dates?.length) return dates.map((date) => date.replaceAll("/", "-")).join("_");
  const now = new Date();
  return [now.getDate(), now.getMonth() + 1, now.getFullYear()].map((part, index) => String(part).padStart(index === 2 ? 4 : 2, "0")).join("-");
}

/** "bao-cao-thu-chi-29-10-2026.pdf" */
export function reportFileName(key: ReportFileKey, dateLabel: string | null | undefined, extension: "png" | "pdf") {
  return `${REPORT_FILE_PREFIX[key]}-${reportFileDate(dateLabel)}.${extension}`;
}
