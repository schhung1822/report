"use client";

import { MoneyInput } from "@/components/costs/money-input";
import { ExpenseLedgerEditor } from "@/components/daily/expense-ledger-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDailyMoney } from "@/lib/daily-report";
import type { useDailyManual } from "@/lib/use-daily-manual";

/**
 * What is typed by hand on a daily report: "Nhận tiền chuyển khoản" (the POS figure is not reliable, so the
 * accountant's number wins) and the cash-out ledger. Used by the daily report page and the consolidated report.
 */
export function DailyManualEntry({ manual, reportDate }: { manual: ReturnType<typeof useDailyManual>; reportDate: string }) {
  const typed = manual.bank !== undefined;
  return (
    <div className="space-y-3 print:hidden">
      <div className="rounded-xl border bg-card px-4 py-3 text-card-foreground">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="bank-transfer-manual" className="text-sm font-semibold">
              Nhận tiền chuyển khoản (tự nhập)
            </Label>
            <MoneyInput
              id="bank-transfer-manual"
              className="h-9 text-right text-sm tabular-nums"
              value={typed ? String(manual.bank) : ""}
              placeholder={String(manual.bankFromSource)}
              onValueChange={(raw) => manual.setBank(raw === "" ? undefined : Math.floor(Number(raw) || 0))}
            />
          </div>
          {typed ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => manual.setBank(undefined)}>
              Dùng số POS / file
            </Button>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {typed
            ? `Báo cáo ngày ${reportDate || "—"} đang dùng số bạn nhập. Số từ POS / file: ${formatDailyMoney(manual.bankFromSource)}.`
            : `Để trống thì báo cáo dùng số từ POS / file (${formatDailyMoney(manual.bankFromSource)}). Số nhập tay được nhớ theo ngày báo cáo trên trình duyệt này.`}
        </p>
      </div>

      <ExpenseLedgerEditor expenses={manual.expenses} reportDate={reportDate} onChange={manual.setExpenses} />
    </div>
  );
}
