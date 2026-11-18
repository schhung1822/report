"use client";

import { useMemo, useState } from "react";
import type { DailyReportData, Expense } from "@/lib/daily-report";
import { loadBankDraft, loadExpenseDraft, reportExpenses, saveBankDraft, saveExpenseDraft } from "@/lib/daily-expenses";

type Manual = {
  date: string | null;
  /** Typed bank transfer; undefined = use the POS / file figure. */
  bank: number | undefined;
  /** Typed ledger rows (blank rows included while typing); undefined = use the report's own rows. */
  expenses: Expense[] | undefined;
};

function loadManual(date: string | null): Manual {
  if (date === null) return { date, bank: undefined, expenses: undefined };
  return { date, bank: loadBankDraft(date), expenses: loadExpenseDraft(date) };
}

/**
 * The hand-typed parts of a daily report: the bank-transfer amount (POS does not record it reliably) and the cash-out
 * ledger. Both are kept per report date in this browser, so fetching the POS again does not wipe them. `view` is the
 * report with those typed values laid over `base`; `base` itself is never changed.
 */
export function useDailyManual(base: DailyReportData | null) {
  const date = base?.reportDate ?? null;
  const [manual, setManual] = useState<Manual>(() => ({ date: null, bank: undefined, expenses: undefined }));

  // Another report date was loaded: take that date's saved entries (adjusting state while rendering, as React allows).
  if (manual.date !== date) setManual(loadManual(date));

  const view = useMemo<DailyReportData | null>(() => {
    if (!base) return null;
    return {
      ...base,
      bankTransfer: manual.bank ?? base.bankTransfer,
      expenses: reportExpenses(manual.expenses ?? base.expenses),
    };
  }, [base, manual.bank, manual.expenses]);

  return {
    view,
    /** The ledger as typed, blank rows included, for the editor. */
    expenses: manual.expenses ?? base?.expenses ?? [],
    bank: manual.bank,
    bankFromSource: base?.bankTransfer ?? 0,
    setBank(amount: number | undefined) {
      if (date === null) return;
      saveBankDraft(date, amount);
      setManual((current) => ({ ...current, bank: amount }));
    },
    setExpenses(expenses: Expense[]) {
      if (date === null) return;
      saveExpenseDraft(date, expenses);
      setManual((current) => ({ ...current, expenses }));
    },
    /** The report date was edited by hand: the typed entries follow it (they are saved under the new date on the next edit). */
    moveTo(reportDate: string) {
      setManual((current) => ({ ...current, date: reportDate }));
    },
    /** Re-read the saved entries of `reportDate` (after the caller stored new ones, e.g. from an uploaded file). */
    reload(reportDate: string) {
      setManual(loadManual(reportDate));
    },
  };
}
