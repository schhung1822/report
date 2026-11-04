export type SheetData = {
  name: string;
  rows: Record<string, unknown>[];
  headers: string[];
};

/** Lower-cases, strips Vietnamese diacritics and collapses punctuation, for tolerant matching. */
export function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Reads every sheet of an .xlsx/.xls/.csv buffer (empty sheets included).
 * `rawText` keeps CSV cells as text; without it SheetJS reads "03/11/2026" as the US date 11 March.
 */
export async function readWorkbookSheets(data: ArrayBuffer, { rawText = false }: { rawText?: boolean } = {}): Promise<SheetData[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellDates: false, raw: rawText });
  return workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], {
      defval: "",
      raw: true,
    });
    return { name, rows, headers: Array.from(new Set(rows.flatMap((row) => Object.keys(row)))) };
  });
}

/** Finds the column whose normalized header equals one of the aliases, falling back to "contains". */
export function findColumnByAlias(headers: string[], aliases: readonly string[]) {
  const normalized = headers.map((original) => ({ original, value: normalizeText(original) }));
  for (const alias of aliases) {
    const exact = normalized.find((header) => header.value === alias);
    if (exact) return exact.original;
  }
  for (const alias of aliases) {
    // Very short aliases ("pos", "ads") only match exactly, to avoid hitting unrelated headers.
    if (alias.length <= 3) continue;
    const partial = normalized.find((header) => header.value.length > 2 && header.value.includes(alias));
    if (partial) return partial.original;
  }
  return undefined;
}
