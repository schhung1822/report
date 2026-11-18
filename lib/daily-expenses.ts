import type { Expense } from "@/lib/daily-report";
import { parseFinanceNumber } from "@/utils/finance";

const DRAFT_PREFIX = "daily-expenses:";
const PAYERS_KEY = "daily-expense-payers";
const MAX_PAYERS = 30;

/** A row the user is typing counts only once it has anything in it. */
export function isFilledExpense(expense: Expense) {
  return Boolean(expense.payer.trim() || expense.supplier.trim() || expense.amount);
}

/** The rows the report shows: blank rows dropped, blank names given the same labels as an uploaded file. */
export function reportExpenses(expenses: Expense[]): Expense[] {
  return expenses.filter(isFilledExpense).map((expense) => ({
    payer: expense.payer.trim() || "Chưa xác định",
    supplier: expense.supplier.trim() || "Khoản chi",
    amount: expense.amount,
  }));
}

/**
 * Reads lines pasted from Excel / Google Sheets / a chat: "Người chi, Tên NCC, Số tiền" separated by tabs (or ; or |),
 * or just "Tên NCC, Số tiền". With two columns the payer is `defaultPayer`. A line without a separator is read as
 * "<name> <amount>" when it ends in a number. Lines that have no amount or no name are returned in `skipped`.
 */
export function parseExpensePaste(text: string, defaultPayer = ""): { expenses: Expense[]; skipped: string[] } {
  const expenses: Expense[] = [];
  const skipped: string[] = [];
  let payer = defaultPayer;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let cells = line.split(/\t|;|\|/).map((cell) => cell.trim());
    if (cells.length === 1) {
      const tail = line.trim().match(/^(.*?)[\s:-]+(-?[\d.,]+)\s*(?:đ|₫|vnd|vnđ)?$/i);
      cells = tail ? [tail[1].trim(), tail[2]] : [line.trim()];
    }
    // A header copied together with the rows.
    if (/^(stt|nguoi chi|người chi)$/i.test(cells[0]) || /^s[ốo] ti[ềe]n/i.test(cells[cells.length - 1])) continue;

    const amountText = cells[cells.length - 1];
    const amount = Math.round(parseFinanceNumber(amountText));
    if (cells.length < 2 || !amount) {
      skipped.push(line.trim());
      continue;
    }
    if (cells.length >= 3) payer = cells[0];
    const supplier = cells.length >= 3 ? cells[1] : cells[0];
    expenses.push({ payer, supplier, amount });
  }
  return { expenses, skipped };
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the ledger still works, it is just not remembered.
  }
}

/** The ledger typed for a report date on this browser, if any. Browser-only: call it from handlers, not while rendering. */
export function loadExpenseDraft(reportDate: string): Expense[] | undefined {
  const rows = readJson<Expense[]>(DRAFT_PREFIX + reportDate.trim());
  if (!Array.isArray(rows)) return undefined;
  return rows.filter((row) => typeof row?.amount === "number").map((row) => ({ payer: String(row.payer ?? ""), supplier: String(row.supplier ?? ""), amount: row.amount }));
}

export function saveExpenseDraft(reportDate: string, expenses: Expense[]) {
  const key = DRAFT_PREFIX + reportDate.trim();
  const filled = expenses.filter(isFilledExpense);
  try {
    if (filled.length) writeJson(key, filled);
    else window.localStorage.removeItem(key);
  } catch {
    // see writeJson
  }
  rememberPayers(filled.map((expense) => expense.payer));
}

/** Payers used before on this browser, most recent first, for the suggestions. */
export function loadPayers(): string[] {
  const payers = readJson<string[]>(PAYERS_KEY);
  return Array.isArray(payers) ? payers.filter((payer) => typeof payer === "string") : [];
}

function rememberPayers(used: string[]) {
  const names = used.map((payer) => payer.trim()).filter(Boolean);
  if (!names.length) return;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const name of [...names.reverse(), ...loadPayers()]) {
    const key = name.toLocaleLowerCase("vi");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(name);
  }
  writeJson(PAYERS_KEY, merged.slice(0, MAX_PAYERS));
}

const BANK_PREFIX = "daily-bank:";

/** The bank-transfer amount typed for a report date on this browser; undefined when nothing was typed. */
export function loadBankDraft(reportDate: string): number | undefined {
  const value = readJson<number>(BANK_PREFIX + reportDate.trim());
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `undefined` forgets the typed amount, so the report falls back to the POS / file figure. */
export function saveBankDraft(reportDate: string, amount: number | undefined) {
  const key = BANK_PREFIX + reportDate.trim();
  if (amount === undefined) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // see writeJson
    }
    return;
  }
  writeJson(key, amount);
}
